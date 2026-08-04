import AVFoundation
import Foundation
import Observation
import Speech

/// Live dictation for the voice logger.
///
/// Prefers on-device recognition wherever the phone supports it, so that what
/// you spend does not leave the device just to be transcribed. When the device
/// has no on-device model for the current locale, recognition falls back to
/// Apple's servers — `isOnDevice` says which is in use so the UI can be honest
/// about it.
@Observable
@MainActor
final class SpeechRecognizer {

    enum Status: Equatable {
        case idle
        case listening
        case denied(String)
        case unavailable(String)
    }

    private(set) var status: Status = .idle
    private(set) var transcript: String = ""
    private(set) var isOnDevice: Bool = false

    /// Smoothed microphone level, 0...1, for the waveform.
    private(set) var audioLevel: Double = 0

    var isListening: Bool { status == .listening }

    private let recognizer: SFSpeechRecognizer?
    private let audioEngine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var silenceTimer: Timer?

    /// Stop listening this long after the last new word. Long enough to think
    /// mid-sentence, short enough that you do not have to reach for the button.
    private let silenceTimeout: TimeInterval = 1.8

    /// Called once the user stops speaking, with the final transcript.
    var onFinish: ((String) -> Void)?

    init(locale: Locale = .autoupdatingCurrent) {
        self.recognizer = SFSpeechRecognizer(locale: locale) ?? SFSpeechRecognizer()
    }

    // MARK: - Permissions

    /// Asks for speech and microphone access. Safe to call repeatedly.
    func requestAuthorization() async -> Bool {
        let speechStatus = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
        }

        guard speechStatus == .authorized else {
            status = .denied("FinApp needs speech recognition access to turn what you say into an expense. You can turn it on in Settings › Privacy & Security › Speech Recognition.")
            return false
        }

        let micGranted = await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { continuation.resume(returning: $0) }
        }

        guard micGranted else {
            status = .denied("FinApp needs the microphone to hear you. You can turn it on in Settings › Privacy & Security › Microphone.")
            return false
        }

        return true
    }

    // MARK: - Recording

    func start() async {
        guard !isListening else { return }
        guard await requestAuthorization() else { return }

        guard let recognizer, recognizer.isAvailable else {
            status = .unavailable("Speech recognition isn't available right now. You can still type the expense in.")
            return
        }

        stopAudio()
        transcript = ""

        do {
            try configureAudioSession()
        } catch {
            status = .unavailable("Couldn't start the microphone: \(error.localizedDescription)")
            return
        }

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.requiresOnDeviceRecognition = recognizer.supportsOnDeviceRecognition
        // Money is the payload — bias the recognizer toward digits.
        request.taskHint = .dictation
        request.addsPunctuation = false
        self.request = request
        self.isOnDevice = recognizer.supportsOnDeviceRecognition

        let inputNode = audioEngine.inputNode
        let format = inputNode.outputFormat(forBus: 0)

        // A zero sample rate means the session never actually gave us the mic.
        guard format.sampleRate > 0 else {
            status = .unavailable("The microphone is busy. Try again in a moment.")
            teardown()
            return
        }

        inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            request.append(buffer)
            let level = SpeechRecognizer.normalizedPower(of: buffer)
            Task { @MainActor [weak self] in
                self?.updateAudioLevel(level)
            }
        }

        audioEngine.prepare()
        do {
            try audioEngine.start()
        } catch {
            status = .unavailable("Couldn't start the microphone: \(error.localizedDescription)")
            teardown()
            return
        }

        status = .listening
        scheduleSilenceTimeout()

        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            Task { @MainActor [weak self] in
                self?.handle(result: result, error: error)
            }
        }
    }

    /// Stops listening and delivers whatever was heard.
    func stop() {
        guard isListening else { return }
        let finalTranscript = transcript
        teardown()
        status = .idle
        if !finalTranscript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            onFinish?(finalTranscript)
        }
    }

    /// Stops listening and throws away the transcript.
    func cancel() {
        teardown()
        transcript = ""
        status = .idle
    }

    func reset() {
        transcript = ""
        if case .denied = status { return }
        status = .idle
    }

    // MARK: - Internals

    private func handle(result: SFSpeechRecognitionResult?, error: Error?) {
        if let result {
            transcript = result.bestTranscription.formattedString
            scheduleSilenceTimeout()
            if result.isFinal {
                stop()
                return
            }
        }

        if error != nil {
            // Recognition errors are routine (silence, cancellation). Keep
            // whatever was transcribed and let the user edit rather than
            // throwing an alert at them.
            if isListening { stop() }
        }
    }

    private func configureAudioSession() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .measurement, options: [.duckOthers])
        try session.setActive(true, options: .notifyOthersOnDeactivation)
    }

    private func scheduleSilenceTimeout() {
        silenceTimer?.invalidate()
        silenceTimer = Timer.scheduledTimer(withTimeInterval: silenceTimeout, repeats: false) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.stop()
            }
        }
    }

    private func updateAudioLevel(_ level: Double) {
        // Exponential smoothing so the waveform breathes instead of flickering.
        audioLevel = audioLevel * 0.7 + level * 0.3
    }

    private func teardown() {
        silenceTimer?.invalidate()
        silenceTimer = nil
        stopAudio()
        task?.cancel()
        task = nil
        request?.endAudio()
        request = nil
        audioLevel = 0
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func stopAudio() {
        if audioEngine.isRunning {
            audioEngine.stop()
        }
        audioEngine.inputNode.removeTap(onBus: 0)
    }

    /// RMS of a buffer mapped onto 0...1 across a ~50 dB window.
    nonisolated private static func normalizedPower(of buffer: AVAudioPCMBuffer) -> Double {
        guard let channelData = buffer.floatChannelData else { return 0 }
        let frames = Int(buffer.frameLength)
        guard frames > 0 else { return 0 }

        var sum: Float = 0
        let samples = channelData[0]
        for index in 0..<frames {
            let sample = samples[index]
            sum += sample * sample
        }

        let rms = (sum / Float(frames)).squareRoot()
        guard rms > 0 else { return 0 }

        let decibels = 20 * log10(rms)
        let floorDB: Float = -50
        let clamped = max(floorDB, min(0, decibels))
        return Double((clamped - floorDB) / -floorDB)
    }
}
