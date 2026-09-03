import SwiftUI

/// The spending buckets FinApp knows about.
///
/// The raw value is what gets persisted, so renaming a case is a migration —
/// add new cases at the end and leave existing raw values alone.
enum ExpenseCategory: String, CaseIterable, Codable, Identifiable, Sendable {
    case groceries
    case diningOut
    case coffee
    case transport
    case fuel
    case shopping
    case bills
    case subscriptions
    case health
    case entertainment
    case travel
    case home
    case education
    case gifts
    case other

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .groceries: return "Groceries"
        case .diningOut: return "Dining out"
        case .coffee: return "Coffee"
        case .transport: return "Transport"
        case .fuel: return "Fuel"
        case .shopping: return "Shopping"
        case .bills: return "Bills"
        case .subscriptions: return "Subscriptions"
        case .health: return "Health"
        case .entertainment: return "Entertainment"
        case .travel: return "Travel"
        case .home: return "Home"
        case .education: return "Education"
        case .gifts: return "Gifts"
        case .other: return "Other"
        }
    }

    var symbolName: String {
        switch self {
        case .groceries: return "cart.fill"
        case .diningOut: return "fork.knife"
        case .coffee: return "cup.and.saucer.fill"
        case .transport: return "bus.fill"
        case .fuel: return "fuelpump.fill"
        case .shopping: return "bag.fill"
        case .bills: return "doc.text.fill"
        case .subscriptions: return "arrow.triangle.2.circlepath"
        case .health: return "cross.case.fill"
        case .entertainment: return "popcorn.fill"
        case .travel: return "airplane"
        case .home: return "house.fill"
        case .education: return "book.fill"
        case .gifts: return "gift.fill"
        case .other: return "circle.grid.2x2.fill"
        }
    }

    var tint: Color {
        switch self {
        case .groceries: return .green
        case .diningOut: return .orange
        case .coffee: return .brown
        case .transport: return .blue
        case .fuel: return .indigo
        case .shopping: return .pink
        case .bills: return .red
        case .subscriptions: return .purple
        case .health: return .mint
        case .entertainment: return .yellow
        case .travel: return .teal
        case .home: return .cyan
        case .education: return .blue
        case .gifts: return .pink
        case .other: return .gray
        }
    }

    /// Words that, when spoken or printed on a statement, point at this category.
    /// Matched as whole words against the lowercased utterance.
    var keywords: [String] {
        switch self {
        case .groceries:
            return ["groceries", "grocery", "supermarket", "market", "produce", "butcher",
                    "bakery", "food shop", "corner store"]
        case .diningOut:
            return ["lunch", "dinner", "breakfast", "brunch", "restaurant", "takeout",
                    "take out", "takeaway", "delivery", "pizza", "burger", "sushi",
                    "tacos", "sandwich", "meal", "ate", "eating", "diner", "bar",
                    "drinks", "beer", "wine", "snack", "ice cream"]
        case .coffee:
            return ["coffee", "espresso", "latte", "cappuccino", "americano", "cafe",
                    "café", "flat white", "cold brew", "tea"]
        case .transport:
            return ["uber", "lyft", "taxi", "cab", "bus", "metro", "subway", "train",
                    "tram", "ferry", "ride", "fare", "toll", "parking", "scooter",
                    "bike share", "transit"]
        case .fuel:
            return ["gas", "petrol", "fuel", "diesel", "gasoline", "filled up", "fill up",
                    "charging", "ev charge"]
        case .shopping:
            return ["clothes", "clothing", "shoes", "shirt", "jacket", "jeans", "dress",
                    "electronics", "headphones", "phone case", "shopping", "bought",
                    "amazon", "online order"]
        case .bills:
            return ["rent", "electricity", "electric bill", "water bill", "gas bill",
                    "internet", "wifi", "phone bill", "utilities", "utility", "insurance",
                    "mortgage", "council tax", "hoa"]
        case .subscriptions:
            return ["subscription", "netflix", "spotify", "hulu", "disney", "icloud",
                    "youtube premium", "prime", "membership", "gym membership", "patreon",
                    "chatgpt", "monthly plan"]
        case .health:
            return ["pharmacy", "drugstore", "medicine", "prescription", "doctor",
                    "dentist", "dental", "clinic", "hospital", "therapy", "therapist",
                    "gym", "vitamins", "optician", "glasses"]
        case .entertainment:
            return ["movie", "movies", "cinema", "concert", "show", "theater", "theatre",
                    "game", "games", "gaming", "museum", "club", "festival", "tickets",
                    "book", "bowling"]
        case .travel:
            return ["flight", "flights", "airline", "hotel", "hostel", "airbnb", "booking",
                    "luggage", "vacation", "holiday", "rental car", "car rental"]
        case .home:
            return ["furniture", "hardware", "ikea", "cleaning", "laundry", "repair",
                    "plumber", "electrician", "decor", "garden", "tools", "paint"]
        case .education:
            return ["course", "class", "tuition", "textbook", "school", "university",
                    "training", "workshop", "certification"]
        case .gifts:
            return ["gift", "gifts", "present", "birthday", "wedding", "donation",
                    "charity", "flowers"]
        case .other:
            return []
        }
    }

    /// Categories in the order the pickers should show them.
    static var selectable: [ExpenseCategory] {
        allCases
    }
}
