import Combine
import SwiftUI

/// Live level meter shown while dictating.
///
/// Its only job is to prove the microphone is hearing you — silence with a
/// spinning indicator is the fastest way to make someone repeat themselves
/// into a dead mic.
struct WaveformView: View {
    /// 0...1, updated as audio arrives.
    let level: Double
    var barCount: Int = 5
    var tint: Color = .accentColor

    @State private var phase: Double = 0

    private let timer = Timer.publish(every: 0.08, on: .main, in: .common).autoconnect()

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<barCount, id: \.self) { index in
                Capsule()
                    .fill(tint)
                    .frame(width: 4, height: height(for: index))
            }
        }
        .animation(.easeOut(duration: 0.12), value: level)
        .animation(.easeOut(duration: 0.12), value: phase)
        .onReceive(timer) { _ in
            phase += 1
        }
        .accessibilityHidden(true)
    }

    private func height(for index: Int) -> CGFloat {
        let minHeight: CGFloat = 6
        let maxHeight: CGFloat = 30

        // Offset each bar around the circle so neighbours never move in lockstep.
        let offset = Double(index) * .pi / 2.5
        let wobble = (sin(phase * 0.6 + offset) + 1) / 2

        // At low input the bars idle; loudness drives most of the height.
        let amplitude = max(0.08, level)
        let scaled = amplitude * (0.55 + 0.45 * wobble)
        return minHeight + (maxHeight - minHeight) * CGFloat(min(1, scaled))
    }
}

#Preview {
    VStack(spacing: 24) {
        WaveformView(level: 0.1)
        WaveformView(level: 0.6)
        WaveformView(level: 1.0)
    }
    .padding()
}
