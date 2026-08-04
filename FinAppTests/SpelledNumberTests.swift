import XCTest
@testable import FinApp

final class SpelledNumberTests: XCTestCase {

    private func runs(_ sentence: String) -> [Int] {
        let tokens = sentence.split(separator: " ").map(String.init)
        return SpelledNumber.runs(in: tokens).map(\.value)
    }

    func testComposesTensAndOnes() {
        XCTAssertEqual(runs("twenty five"), [25])
        XCTAssertEqual(runs("ninety nine"), [99])
    }

    func testComposesHundredsAndThousands() {
        XCTAssertEqual(runs("one hundred twenty five"), [125])
        XCTAssertEqual(runs("one hundred and twenty five"), [125])
        XCTAssertEqual(runs("two thousand five hundred"), [2500])
        XCTAssertEqual(runs("hundred"), [100])
    }

    /// The case that makes or breaks spoken money: "twelve fifty" is two
    /// numbers, and merging them into 1250 would be catastrophic.
    func testAdjacentNumbersStaySeparate() {
        XCTAssertEqual(runs("twelve fifty"), [12, 50])
        XCTAssertEqual(runs("five fifty"), [5, 50])
        XCTAssertEqual(runs("nineteen ninety nine"), [19, 99])
    }

    func testIgnoresSurroundingWords() {
        XCTAssertEqual(runs("i spent twenty on lunch"), [20])
        XCTAssertEqual(runs("no numbers at all here"), [])
    }

    func testTrailingAndIsNotSwallowed() {
        // "twenty and" — the "and" joins clauses, not digits.
        XCTAssertEqual(runs("twenty and coffee"), [20])
    }

    func testValueOfWholePhrase() {
        XCTAssertEqual(SpelledNumber.value(of: "twenty five"), 25)
        XCTAssertEqual(SpelledNumber.value(of: "three"), 3)
        // Two numbers is not one value.
        XCTAssertNil(SpelledNumber.value(of: "twelve fifty"))
        XCTAssertNil(SpelledNumber.value(of: "coffee"))
    }
}
