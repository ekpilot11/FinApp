import AppIntents

/// Makes categories selectable inside the Shortcuts editor and by Siri.
extension ExpenseCategory: AppEnum {

    static var typeDisplayRepresentation: TypeDisplayRepresentation {
        TypeDisplayRepresentation(name: "Category")
    }

    static var caseDisplayRepresentations: [ExpenseCategory: DisplayRepresentation] {
        var representations: [ExpenseCategory: DisplayRepresentation] = [:]
        for category in ExpenseCategory.allCases {
            representations[category] = DisplayRepresentation(
                title: LocalizedStringResource(stringLiteral: category.displayName),
                image: .init(systemName: category.symbolName)
            )
        }
        return representations
    }
}
