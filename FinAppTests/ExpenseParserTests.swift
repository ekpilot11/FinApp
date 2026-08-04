import XCTest
@testable import FinApp

final class ExpenseParserTests: XCTestCase {

    private let calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        return calendar
    }()

    /// Tuesday 4 August 2026, 10:00 UTC.
    private lazy var reference: Date = day(2026, 8, 4, hour: 10)

    private func day(_ year: Int, _ month: Int, _ dayOfMonth: Int, hour: Int = 12) -> Date {
        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = dayOfMonth
        components.hour = hour
        return calendar.date(from: components)!
    }

    private func parse(_ text: String, currency: String = "USD") -> ParsedExpense {
        ExpenseParser.parse(text, referenceDate: reference, defaultCurrency: currency, calendar: calendar)
    }

    // MARK: - Amounts

    func testSpokenDollarsAndCents() {
        let result = parse("spent twelve fifty on coffee at Starbucks")
        XCTAssertEqual(result.amount, Decimal(string: "12.50"))
        XCTAssertEqual(result.merchant, "Starbucks")
        XCTAssertEqual(result.category, .coffee)
    }

    func testSpokenWholeNumberWithCurrencyWord() {
        let result = parse("twenty five bucks on lunch")
        XCTAssertEqual(result.amount, 25)
        XCTAssertEqual(result.currencyCode, "USD")
        XCTAssertEqual(result.category, .diningOut)
        XCTAssertEqual(result.note, "Lunch")
    }

    func testSpokenCentsPhrase() {
        let result = parse("twelve dollars and fifty cents for parking")
        XCTAssertEqual(result.amount, Decimal(string: "12.50"))
    }

    func testDigitCentsPhrase() {
        let result = parse("12 dollars and 50 cents for parking")
        XCTAssertEqual(result.amount, Decimal(string: "12.50"))
        XCTAssertEqual(result.category, .transport)
    }

    func testDigitsWithSymbol() {
        let result = parse("$45.99 at Whole Foods")
        XCTAssertEqual(result.amount, Decimal(string: "45.99"))
        XCTAssertEqual(result.merchant, "Whole Foods")
        XCTAssertEqual(result.category, .groceries)
    }

    func testForeignCurrencySymbolOverridesDefault() {
        let result = parse("€30 on dinner")
        XCTAssertEqual(result.amount, 30)
        XCTAssertEqual(result.currencyCode, "EUR")
    }

    func testCurrencyWordOverridesDefault() {
        let result = parse("spent 40 euros at the pharmacy")
        XCTAssertEqual(result.amount, 40)
        XCTAssertEqual(result.currencyCode, "EUR")
    }

    func testPrefersTheNumberCarryingCurrency() {
        // The 3 belongs to the date phrase; the 20 is the money.
        let result = parse("3 days ago I spent $20 on a taxi")
        XCTAssertEqual(result.amount, 20)
    }

    func testMissingAmountIsNotUsable() {
        let result = parse("bought a coffee at the place downstairs")
        XCTAssertNil(result.amount)
        XCTAssertFalse(result.isUsable)
        XCTAssertLessThan(result.confidence, ExpenseParser.reviewThreshold)
    }

    // MARK: - Decimal separators

    func testDecimalSeparatorHandling() {
        XCTAssertEqual(ExpenseParser.decimalValue(fromDigits: "12.50"), Decimal(string: "12.50"))
        XCTAssertEqual(ExpenseParser.decimalValue(fromDigits: "12,50"), Decimal(string: "12.50"))
        XCTAssertEqual(ExpenseParser.decimalValue(fromDigits: "1,250.75"), Decimal(string: "1250.75"))
        XCTAssertEqual(ExpenseParser.decimalValue(fromDigits: "1.250,75"), Decimal(string: "1250.75"))
        // Three trailing digits are a thousands group, not a fraction.
        XCTAssertEqual(ExpenseParser.decimalValue(fromDigits: "1.250"), 1250)
        XCTAssertEqual(ExpenseParser.decimalValue(fromDigits: "1,250"), 1250)
    }

    // MARK: - Dates

    func testYesterday() {
        let result = parse("spent 10 dollars on coffee yesterday")
        XCTAssertTrue(result.dateWasExplicit)
        XCTAssertTrue(calendar.isDate(result.date, inSameDayAs: day(2026, 8, 3)))
    }

    func testLastNightIsYesterday() {
        let result = parse("30 bucks on drinks last night")
        XCTAssertTrue(calendar.isDate(result.date, inSameDayAs: day(2026, 8, 3)))
    }

    func testDaysAgo() {
        let result = parse("paid 20 dollars for parking 3 days ago")
        XCTAssertTrue(calendar.isDate(result.date, inSameDayAs: day(2026, 8, 1)))
    }

    func testSpelledDaysAgo() {
        let result = parse("paid 20 dollars for parking two days ago")
        XCTAssertTrue(calendar.isDate(result.date, inSameDayAs: day(2026, 8, 2)))
    }

    func testWeeksAgo() {
        let result = parse("15 dollars on a book two weeks ago")
        XCTAssertTrue(calendar.isDate(result.date, inSameDayAs: day(2026, 7, 21)))
    }

    func testWeekdayResolvesToThePast() {
        let result = parse("spent 25 dollars on groceries on friday")
        XCTAssertTrue(result.dateWasExplicit)
        XCTAssertEqual(calendar.component(.weekday, from: result.date), 6, "Friday is weekday 6")
        XCTAssertLessThanOrEqual(result.date, reference)
        XCTAssertGreaterThan(result.date, calendar.date(byAdding: .day, value: -8, to: reference)!)
    }

    func testExplicitCalendarDate() {
        let result = parse("spent 60 dollars on July 12")
        XCTAssertTrue(calendar.isDate(result.date, inSameDayAs: day(2026, 7, 12)))
    }

    /// A month later than today can only mean last year.
    func testFutureLookingDateRollsBackAYear() {
        let result = parse("spent 60 dollars on December 12")
        XCTAssertTrue(calendar.isDate(result.date, inSameDayAs: day(2025, 12, 12)))
    }

    func testNoDatePhraseMeansNow() {
        let result = parse("spent 10 dollars on coffee")
        XCTAssertFalse(result.dateWasExplicit)
        XCTAssertEqual(result.date, reference)
    }

    // MARK: - Merchants

    func testMerchantAfterAt() {
        XCTAssertEqual(parse("15 dollars at Chipotle").merchant, "Chipotle")
    }

    func testMerchantAfterFrom() {
        XCTAssertEqual(parse("60 dollars from Ikea").merchant, "Ikea")
    }

    func testMerchantSkipsArticle() {
        XCTAssertEqual(parse("8 dollars at the corner store").merchant, "Corner Store")
    }

    func testMerchantStopsAtTimeWords() {
        XCTAssertEqual(parse("8 dollars at Pret yesterday").merchant, "Pret")
    }

    func testNoMerchantWhenNoneSpoken() {
        XCTAssertNil(parse("spent 8 dollars on coffee").merchant)
    }

    // MARK: - Refunds

    func testRefundIsNegative() {
        let result = parse("got refunded 30 dollars from Zara")
        XCTAssertTrue(result.isRefund)
        XCTAssertEqual(result.amount, 30)
        XCTAssertEqual(result.signedAmount, -30)
        XCTAssertEqual(result.merchant, "Zara")
    }

    // MARK: - Confidence

    func testCompleteSentenceIsConfident() {
        let result = parse("spent twelve fifty on coffee at Starbucks yesterday")
        XCTAssertGreaterThanOrEqual(result.confidence, ExpenseParser.reviewThreshold)
    }

    func testBareNumberIsNotConfident() {
        let result = parse("twelve")
        XCTAssertEqual(result.amount, 12)
        XCTAssertLessThan(result.confidence, ExpenseParser.reviewThreshold)
    }

    // MARK: - Notes

    func testNoteDropsFillerAndConsumedPhrases() {
        let result = parse("I spent 20 dollars on lunch at Chipotle yesterday")
        XCTAssertEqual(result.note, "Lunch")
    }
}
