import SwiftData
import XCTest
@testable import FinApp

final class ExpenseStoreTests: XCTestCase {

    private var container: ModelContainer!
    private var context: ModelContext!

    override func setUpWithError() throws {
        container = AppContainer.inMemory()
        context = ModelContext(container)
    }

    override func tearDownWithError() throws {
        context = nil
        container = nil
    }

    private func count() throws -> Int {
        try context.fetchCount(FetchDescriptor<Expense>())
    }

    private func all() throws -> [Expense] {
        try context.fetch(FetchDescriptor<Expense>())
    }

    // MARK: - De-duplication

    /// Two coffees at the same price on the same day are two coffees. Only
    /// automatic sources get merged.
    func testIdenticalManualEntriesAreBothKept() throws {
        try ExpenseStore.insert(
            Expense(amount: 4.75, currencyCode: "USD", merchant: "Blue Bottle", source: .manual),
            into: context
        )
        try ExpenseStore.insert(
            Expense(amount: 4.75, currencyCode: "USD", merchant: "Blue Bottle", source: .manual),
            into: context
        )
        XCTAssertEqual(try count(), 2)
    }

    func testSameExternalIDIsNotImportedTwice() throws {
        let first = Expense(amount: 20, currencyCode: "USD", merchant: "Shell",
                            source: .bankSync, externalID: "txn_1")
        let second = Expense(amount: 20, currencyCode: "USD", merchant: "Shell",
                             source: .bankSync, externalID: "txn_1")

        try ExpenseStore.insert(first, into: context)
        try ExpenseStore.insert(second, into: context)

        XCTAssertEqual(try count(), 1)
    }

    /// The scenario this whole mechanism exists for: Apple Pay logs the coffee
    /// instantly, the bank reports the same coffee two days later.
    func testApplePayAndBankFeedCollapseIntoOneRow() throws {
        let tapped = Date(timeIntervalSince1970: 1_770_000_000)
        let settled = tapped.addingTimeInterval(2 * 24 * 60 * 60)

        try ExpenseStore.insert(
            Expense(amount: Decimal(string: "4.75")!, currencyCode: "USD",
                    merchant: "Blue Bottle", date: tapped, category: .coffee,
                    source: .cardAutomation, externalID: "applepay:4.75:blue-bottle:2026-02-01"),
            into: context
        )

        try ExpenseStore.insert(
            Expense(amount: Decimal(string: "4.75")!, currencyCode: "USD",
                    merchant: "SQ *BLUE BOTTLE 4471 OAKLAND CA", date: settled,
                    category: .coffee, source: .bankSync, externalID: "txn_bank_9"),
            into: context
        )

        let rows = try all()
        XCTAssertEqual(rows.count, 1)

        // The bank's id must win, or a later settlement update could not find it.
        XCTAssertEqual(rows.first?.externalID, "txn_bank_9")
        XCTAssertEqual(rows.first?.date, settled)
    }

    func testDifferentAmountsAreNotMerged() throws {
        let now = Date()
        try ExpenseStore.insert(
            Expense(amount: 4.75, currencyCode: "USD", merchant: "Blue Bottle",
                    date: now, source: .cardAutomation),
            into: context
        )
        try ExpenseStore.insert(
            Expense(amount: 5.25, currencyCode: "USD", merchant: "Blue Bottle",
                    date: now, source: .bankSync, externalID: "txn_2"),
            into: context
        )
        XCTAssertEqual(try count(), 2)
    }

    func testFarApartPurchasesAreNotMerged() throws {
        let now = Date()
        try ExpenseStore.insert(
            Expense(amount: 4.75, currencyCode: "USD", merchant: "Blue Bottle",
                    date: now, source: .cardAutomation),
            into: context
        )
        try ExpenseStore.insert(
            Expense(amount: 4.75, currencyCode: "USD", merchant: "Blue Bottle",
                    date: now.addingTimeInterval(30 * 24 * 60 * 60),
                    source: .bankSync, externalID: "txn_3"),
            into: context
        )
        XCTAssertEqual(try count(), 2)
    }

    func testDifferentCurrenciesAreNotMerged() throws {
        let now = Date()
        try ExpenseStore.insert(
            Expense(amount: 10, currencyCode: "USD", merchant: "Cafe", date: now, source: .cardAutomation),
            into: context
        )
        try ExpenseStore.insert(
            Expense(amount: 10, currencyCode: "EUR", merchant: "Cafe", date: now,
                    source: .bankSync, externalID: "txn_4"),
            into: context
        )
        XCTAssertEqual(try count(), 2)
    }

    // MARK: - Merchant matching

    func testMerchantMatching() {
        XCTAssertTrue(ExpenseStore.merchantsMatch("Blue Bottle", "SQ *BLUE BOTTLE 4471 OAKLAND CA"))
        XCTAssertTrue(ExpenseStore.merchantsMatch("Starbucks", "STARBUCKS STORE 1234"))
        // An automation that reported no merchant should still be matchable.
        XCTAssertTrue(ExpenseStore.merchantsMatch("", "Whole Foods"))
        XCTAssertFalse(ExpenseStore.merchantsMatch("Whole Foods", "Shell Gas Station"))
    }

    // MARK: - Review state

    func testAutomaticEntriesArriveUnreviewed() throws {
        let bank = Expense(amount: 12, currencyCode: "USD", source: .bankSync, externalID: "txn_5")
        let voice = Expense(amount: 12, currencyCode: "USD", source: .voice)

        XCTAssertFalse(bank.isReviewed)
        XCTAssertTrue(voice.isReviewed)

        try ExpenseStore.insert(bank, into: context)
        try ExpenseStore.insert(voice, into: context)
        XCTAssertEqual(try ExpenseStore.unreviewedCount(context: context), 1)
    }

    // MARK: - Aggregation

    func testTotalsIgnoreOtherCurrencies() throws {
        let expenses = [
            Expense(amount: 10, currencyCode: "USD"),
            Expense(amount: 25, currencyCode: "USD"),
            Expense(amount: 99, currencyCode: "EUR")
        ]
        XCTAssertEqual(ExpenseStore.total(of: expenses, currencyCode: "USD"), 35)
        XCTAssertEqual(ExpenseStore.total(of: expenses, currencyCode: "EUR"), 99)
    }

    func testTotalsByCategoryAreSortedAndFiltered() {
        let expenses = [
            Expense(amount: 10, currencyCode: "USD", category: .coffee),
            Expense(amount: 40, currencyCode: "USD", category: .groceries),
            Expense(amount: 5, currencyCode: "USD", category: .coffee)
        ]
        let totals = ExpenseStore.totalsByCategory(expenses, currencyCode: "USD")

        XCTAssertEqual(totals.count, 2)
        XCTAssertEqual(totals[0].category, .groceries)
        XCTAssertEqual(totals[0].total, 40)
        XCTAssertEqual(totals[1].category, .coffee)
        XCTAssertEqual(totals[1].total, 15)
    }

    func testTotalsByDayCoverEveryDayInRange() {
        let calendar = Calendar(identifier: .gregorian)
        let start = calendar.startOfDay(for: Date(timeIntervalSince1970: 1_770_000_000))
        let end = calendar.date(byAdding: .day, value: 3, to: start)!
        let interval = DateInterval(start: start, end: end)

        let expenses = [
            Expense(amount: 10, currencyCode: "USD", date: start.addingTimeInterval(3600)),
            Expense(amount: 5, currencyCode: "USD", date: start.addingTimeInterval(7200))
        ]

        let daily = ExpenseStore.totalsByDay(expenses, in: interval, currencyCode: "USD", calendar: calendar)

        XCTAssertEqual(daily.count, 3, "Empty days must still appear so the chart has no gaps")
        XCTAssertEqual(daily[0].total, 15)
        XCTAssertEqual(daily[1].total, 0)
        XCTAssertEqual(daily[2].total, 0)
    }

    // MARK: - Apple Pay fingerprint

    func testFingerprintIsStableForTheSamePurchase() {
        let date = Date(timeIntervalSince1970: 1_770_000_000)
        let first = ImportCardTransactionIntent.fingerprint(amount: Decimal(string: "4.75")!,
                                                            merchant: "Blue Bottle", date: date)
        let second = ImportCardTransactionIntent.fingerprint(amount: Decimal(string: "4.75")!,
                                                             merchant: "BLUE BOTTLE", date: date)
        XCTAssertEqual(first, second, "Casing must not create a second fingerprint")
    }
}
