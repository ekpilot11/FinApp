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

    /// Brand names outrank every keyword, so a brand matching inside an
    /// ordinary word is unrecoverable. "grabbed lunch" read as the Grab ride
    /// app is the case that caught this.
    func testBrandsDoNotMatchInsideOrdinaryWords() {
        XCTAssertEqual(CategoryClassifier.classify(text: "grabbed lunch downtown"), .diningOut)
        XCTAssertEqual(CategoryClassifier.classify(text: "mobile phone bill"), .bills)
        XCTAssertEqual(CategoryClassifier.classify(text: "shellfish for dinner"), .diningOut)
        XCTAssertEqual(CategoryClassifier.classify(text: "targeted ads course"), .education)
    }

    /// Brands whose name is itself a whole common word have to be left out
    /// entirely — word boundaries cannot save these.
    func testCommonWordsAreNotTreatedAsBrands() {
        XCTAssertEqual(CategoryClassifier.classify(text: "grab a coffee"), .coffee)
        XCTAssertEqual(CategoryClassifier.classify(text: "grab lunch with Ana"), .diningOut)
    }

    func testRealBrandsStillMatch() {
        XCTAssertEqual(CategoryClassifier.classify(text: "BP", merchant: "BP"), .fuel)
        XCTAssertEqual(CategoryClassifier.classify(text: "MOBIL 4471"), .fuel)
        XCTAssertEqual(CategoryClassifier.classify(text: "UBER TRIP"), .transport)
        XCTAssertEqual(CategoryClassifier.classify(text: "H&M 0231"), .shopping)
    }

    /// Brands listed in stem form have to survive a statement descriptor that
    /// writes them plural — the exact thing a hard word boundary would break.
    func testStemFormBrandsMatchPluralDescriptors() {
        XCTAssertEqual(CategoryClassifier.classify(text: "MCDONALDS 1234"), .diningOut)
        XCTAssertEqual(CategoryClassifier.classify(text: "LOWES #22"), .home)
        XCTAssertEqual(CategoryClassifier.classify(text: "TRADER JOES"), .groceries)
        XCTAssertEqual(CategoryClassifier.classify(text: "AMC THEATRES 8"), .entertainment)
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
