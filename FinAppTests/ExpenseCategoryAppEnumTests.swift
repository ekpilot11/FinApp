import AppIntents
import XCTest
@testable import FinApp

/// Guards the hand-written App Intents metadata tables.
///
/// `ExtractAppIntentsMetadata` reads those tables statically, so they cannot be
/// generated from `allCases` and instead duplicate it. A case added to the enum
/// without a matching entry would otherwise fail the *build* with a metadata
/// error rather than anything that points at the real cause. This fails first,
/// and says what is missing.
final class ExpenseCategoryAppEnumTests: XCTestCase {

    func testEveryCategoryHasADisplayRepresentation() {
        let described = Set(ExpenseCategory.caseDisplayRepresentations.keys)
        let missing = Set(ExpenseCategory.allCases).subtracting(described)

        XCTAssertTrue(
            missing.isEmpty,
            "Add these to caseDisplayRepresentations in ExpenseCategory+AppEnum.swift: "
                + missing.map(\.rawValue).sorted().joined(separator: ", ")
        )
    }

    func testEverySummaryPeriodHasADisplayRepresentation() {
        let described = Set(SummaryPeriod.caseDisplayRepresentations.keys)
        let missing = Set(SummaryPeriod.allCases).subtracting(described)

        XCTAssertTrue(
            missing.isEmpty,
            "Add these to caseDisplayRepresentations in SpendingSummaryIntent.swift: "
                + missing.map(\.rawValue).sorted().joined(separator: ", ")
        )
    }
}
