import XCTest
@testable import FinApp

final class CategoryClassifierTests: XCTestCase {

    func testBrandBeatsKeyword() {
        // "bar" is a dining keyword, but the merchant is unambiguous.
        XCTAssertEqual(
            CategoryClassifier.classify(text: "drinks at the bar", merchant: "Starbucks"),
            .coffee
        )
    }

    func testKeywordsFromASpokenSentence() {
        XCTAssertEqual(CategoryClassifier.classify(text: "grabbed lunch downtown"), .diningOut)
        XCTAssertEqual(CategoryClassifier.classify(text: "filled up the tank with petrol"), .fuel)
        XCTAssertEqual(CategoryClassifier.classify(text: "monthly rent"), .bills)
        XCTAssertEqual(CategoryClassifier.classify(text: "picked up a prescription"), .health)
    }

    func testLongerKeywordWins() {
        // "gym" alone is health; "gym membership" is a subscription.
        XCTAssertEqual(CategoryClassifier.classify(text: "gym membership"), .subscriptions)
        XCTAssertEqual(CategoryClassifier.classify(text: "day pass at the gym"), .health)
    }

    func testWordBoundariesAreRespected() {
        // "gas" must not fire on "gasket"; "bar" must not fire on "barber".
        XCTAssertEqual(CategoryClassifier.classify(text: "replacement gasket"), .other)
        XCTAssertEqual(CategoryClassifier.classify(text: "haircut at the barbers"), .other)
    }

    func testNoisyStatementDescriptors() {
        XCTAssertEqual(
            CategoryClassifier.classify(text: "SQ *BLUE BOTTLE 4471 OAKLAND CA", merchant: nil),
            .coffee
        )
        XCTAssertEqual(
            CategoryClassifier.classify(text: "UBER   *TRIP HELP.UBER.COM", merchant: nil),
            .transport
        )
    }

    func testUnknownFallsBackToOther() {
        XCTAssertEqual(CategoryClassifier.classify(text: "zzzz qqqq"), .other)
    }

    func testNormalizeStripsProcessorPrefixes() {
        XCTAssertEqual(CategoryClassifier.normalize("SQ *Blue Bottle"), "blue bottle")
        XCTAssertEqual(CategoryClassifier.normalize("  Café   Corner  "), "cafe corner")
    }
}
