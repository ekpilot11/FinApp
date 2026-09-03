import SwiftUI

/// Horizontal progress for "spent so far against a limit".
struct BudgetBar: View {
    let spent: Decimal
    let limit: Decimal
    let currencyCode: String
    var tint: Color = .accentColor

    private var fraction: Double {
        guard limit > 0 else { return 0 }
        return min(1, max(0, spent.doubleValue / limit.doubleValue))
    }

    private var isOver: Bool { limit > 0 && spent > limit }

    /// Amber once the limit is close, red once it is gone.
    private var barColor: Color {
        if isOver { return .red }
        if fraction > 0.85 { return .orange }
        return tint
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(Color(.systemFill))
                    Capsule()
                        .fill(barColor)
                        .frame(width: max(proxy.size.width * fraction, fraction > 0 ? 6 : 0))
                }
            }
            .frame(height: 8)

            HStack {
                Text(spent.formatted(.currency(code: currencyCode)))
                    .font(.caption)
                    .monospacedDigit()
                    .foregroundStyle(isOver ? Color.red : Color.secondary)
                Spacer()
                if limit > 0 {
                    Text(remainingText)
                        .font(.caption)
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityLabel)
    }

    private var remainingText: String {
        let remaining = limit - spent
        if remaining < 0 {
            return "\((-remaining).formatted(.currency(code: currencyCode))) over"
        }
        return "\(remaining.formatted(.currency(code: currencyCode))) left"
    }

    private var accessibilityLabel: String {
        guard limit > 0 else { return "\(spent.formatted(.currency(code: currencyCode))) spent" }
        return "\(spent.formatted(.currency(code: currencyCode))) of \(limit.formatted(.currency(code: currencyCode))), \(remainingText)"
    }
}

extension Decimal {
    var doubleValue: Double {
        NSDecimalNumber(decimal: self).doubleValue
    }
}

#Preview {
    VStack(spacing: 24) {
        BudgetBar(spent: 120, limit: 400, currencyCode: "USD")
        BudgetBar(spent: 370, limit: 400, currencyCode: "USD")
        BudgetBar(spent: 480, limit: 400, currencyCode: "USD")
    }
    .padding()
}
