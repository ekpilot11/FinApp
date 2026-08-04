import AppIntents

/// Makes categories selectable inside the Shortcuts editor and by Siri.
///
/// Everything below is spelled out as literals on purpose. The
/// `ExtractAppIntentsMetadata` build step reads these declarations
/// *statically* — it never runs the code — so it cannot follow a loop over
/// `allCases`, and it cannot read a `LocalizedStringResource` built from a
/// runtime string. Generating this table programmatically fails the build with
/// no compiler error, only a metadata-extraction failure.
///
/// The cost is that the titles here duplicate `ExpenseCategory.displayName` and
/// `symbolName`. `ExpenseCategoryAppEnumTests` fails if a new case is added
/// without being listed here.
extension ExpenseCategory: AppEnum {

    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Category")

    static var caseDisplayRepresentations: [ExpenseCategory: DisplayRepresentation] = [
        .groceries: DisplayRepresentation(title: "Groceries", image: .init(systemName: "cart.fill")),
        .diningOut: DisplayRepresentation(title: "Dining out", image: .init(systemName: "fork.knife")),
        .coffee: DisplayRepresentation(title: "Coffee", image: .init(systemName: "cup.and.saucer.fill")),
        .transport: DisplayRepresentation(title: "Transport", image: .init(systemName: "bus.fill")),
        .fuel: DisplayRepresentation(title: "Fuel", image: .init(systemName: "fuelpump.fill")),
        .shopping: DisplayRepresentation(title: "Shopping", image: .init(systemName: "bag.fill")),
        .bills: DisplayRepresentation(title: "Bills", image: .init(systemName: "doc.text.fill")),
        .subscriptions: DisplayRepresentation(title: "Subscriptions", image: .init(systemName: "arrow.triangle.2.circlepath")),
        .health: DisplayRepresentation(title: "Health", image: .init(systemName: "cross.case.fill")),
        .entertainment: DisplayRepresentation(title: "Entertainment", image: .init(systemName: "popcorn.fill")),
        .travel: DisplayRepresentation(title: "Travel", image: .init(systemName: "airplane")),
        .home: DisplayRepresentation(title: "Home", image: .init(systemName: "house.fill")),
        .education: DisplayRepresentation(title: "Education", image: .init(systemName: "book.fill")),
        .gifts: DisplayRepresentation(title: "Gifts", image: .init(systemName: "gift.fill")),
        .other: DisplayRepresentation(title: "Other", image: .init(systemName: "circle.grid.2x2.fill"))
    ]
}
