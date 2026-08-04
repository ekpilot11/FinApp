import SwiftUI

struct CategoryIcon: View {
    let category: ExpenseCategory
    var size: CGFloat = 38

    var body: some View {
        ZStack {
            Circle()
                .fill(category.tint.opacity(0.16))
            Image(systemName: category.symbolName)
                .font(.system(size: size * 0.42, weight: .semibold))
                .foregroundStyle(category.tint)
        }
        .frame(width: size, height: size)
    }
}

struct ExpenseRow: View {
    let expense: Expense

    var body: some View {
        HStack(spacing: 12) {
            CategoryIcon(category: expense.category)

            VStack(alignment: .leading, spacing: 2) {
                Text(expense.title)
                    .font(.body)
                    .fontWeight(.medium)
                    .lineLimit(1)

                HStack(spacing: 4) {
                    Text(expense.category.displayName)
                    if expense.source != .manual {
                        Text("·")
                        Image(systemName: expense.source.symbolName)
                            .imageScale(.small)
                    }
                    if expense.isPending {
                        Text("· Pending")
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }

            Spacer(minLength: 8)

            VStack(alignment: .trailing, spacing: 2) {
                Text(expense.formattedAmount)
                    .font(.body)
                    .fontWeight(.semibold)
                    .monospacedDigit()
                    // A refund is money coming back — the sign alone is easy to miss.
                    .foregroundStyle(expense.amount < 0 ? Color.green : Color.primary)

                Text(expense.date, format: .dateTime.hour().minute())
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .monospacedDigit()
            }
        }
        .padding(.vertical, 4)
        .overlay(alignment: .leading) {
            if !expense.isReviewed {
                // Marks rows that arrived on their own and have not been checked.
                Circle()
                    .fill(Color.accentColor)
                    .frame(width: 6, height: 6)
                    .offset(x: -12)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
    }

    private var accessibilityLabel: String {
        var parts = [expense.formattedAmount, expense.title, expense.category.displayName]
        if expense.isPending { parts.append("pending") }
        if !expense.isReviewed { parts.append("needs review") }
        return parts.joined(separator: ", ")
    }
}

#Preview {
    List {
        ExpenseRow(expense: Expense(amount: 4.75, currencyCode: "USD", merchant: "Blue Bottle",
                                    category: .coffee, source: .voice))
        ExpenseRow(expense: Expense(amount: 62.10, currencyCode: "USD", merchant: "Whole Foods",
                                    category: .groceries, source: .bankSync, isPending: true,
                                    isReviewed: false))
        ExpenseRow(expense: Expense(amount: -20, currencyCode: "USD", merchant: "Zara",
                                    category: .shopping, source: .manual))
    }
}
