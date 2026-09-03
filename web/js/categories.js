// The spending buckets FinApp knows about.
//
// Ported from ExpenseCategory.swift. The `id` is what gets persisted, so
// renaming one is a migration — add new entries at the end and leave existing
// ids alone. SF Symbols do not exist on the web, hence the emoji.

/** @typedef {'groceries'|'diningOut'|'coffee'|'transport'|'fuel'|'shopping'|'bills'|'subscriptions'|'health'|'entertainment'|'travel'|'home'|'education'|'gifts'|'other'} CategoryID */

export const CATEGORIES = [
  {
    id: 'groceries',
    name: 'Groceries',
    icon: '🛒',
    color: '#34C759',
    keywords: [
      'groceries', 'grocery', 'supermarket', 'market', 'produce', 'butcher', 'bakery',
      'food shop', 'corner store', 'mercado', 'supermercado', 'mercearia',
      'hortifruti', 'sacolao', 'acougue', 'padaria', 'quitanda', 'empório', 'emporio',
      'atacadao', 'alimentos', 'feira']
  },
  {
    id: 'diningOut',
    name: 'Dining out',
    icon: '🍽️',
    color: '#FF9500',
    keywords: [
      'lunch', 'dinner', 'breakfast', 'brunch', 'restaurant', 'takeout', 'take out',
      'takeaway', 'delivery', 'pizza', 'burger', 'sushi', 'tacos', 'sandwich', 'meal',
      'ate', 'eating', 'diner', 'bar', 'drinks', 'beer', 'wine', 'snack', 'ice cream',
      'restaurante', 'lanchonete', 'lanche', 'almoço', 'almoco', 'jantar', 'janta',
      'churrascaria', 'pizzaria', 'hamburgueria', 'esfiha', 'sorveteria', 'sorvete',
      'açaí', 'acai', 'bar do', 'boteco', 'petisco', 'marmita', 'self service',
      'comida']
  },
  {
    id: 'coffee',
    name: 'Coffee',
    icon: '☕️',
    color: '#A2845E',
    keywords: [
      'coffee', 'espresso', 'latte', 'cappuccino', 'americano', 'cafe', 'café',
      'flat white', 'cold brew', 'tea', 'cafeteria', 'cafezinho', 'padaria café']
  },
  {
    id: 'transport',
    name: 'Transport',
    icon: '🚌',
    color: '#007AFF',
    keywords: [
      'uber', 'lyft', 'taxi', 'cab', 'bus', 'metro', 'subway', 'train', 'tram',
      'ferry', 'ride', 'fare', 'toll', 'parking', 'scooter', 'bike share', 'transit',
      'onibus', 'ônibus', 'metrô', 'passagem', 'pedagio', 'pedágio', 'estacionamento',
      'zona azul', 'corrida', 'táxi', 'bilhete unico', 'transporte']
  },
  {
    id: 'fuel',
    name: 'Fuel',
    icon: '⛽️',
    color: '#5856D6',
    keywords: [
      'gas', 'petrol', 'fuel', 'diesel', 'gasoline', 'filled up', 'fill up',
      'charging', 'ev charge', 'posto', 'combustivel', 'combustível', 'gasolina',
      'etanol', 'álcool', 'alcool', 'abastecimento']
  },
  {
    id: 'shopping',
    name: 'Shopping',
    icon: '🛍️',
    color: '#FF2D55',
    keywords: [
      'clothes', 'clothing', 'shoes', 'shirt', 'jacket', 'jeans', 'dress',
      'electronics', 'headphones', 'phone case', 'shopping', 'bought', 'amazon',
      'online order', 'loja', 'magazine', 'roupas', 'calçados', 'calcados',
      'vestuario', 'papelaria', 'livraria']
  },
  {
    id: 'bills',
    name: 'Bills',
    icon: '📄',
    color: '#FF3B30',
    keywords: [
      'rent', 'electricity', 'electric bill', 'water bill', 'gas bill', 'internet',
      'wifi', 'phone bill', 'utilities', 'utility', 'insurance', 'mortgage',
      'council tax', 'hoa', 'aluguel', 'conta de luz', 'energia', 'agua', 'água',
      'saneamento', 'telefone', 'celular', 'condominio', 'condomínio', 'iptu',
      'seguro', 'boleto', 'mensalidade']
  },
  {
    id: 'subscriptions',
    name: 'Subscriptions',
    icon: '🔁',
    color: '#AF52DE',
    keywords: [
      'subscription', 'netflix', 'spotify', 'hulu', 'disney', 'icloud',
      'youtube premium', 'prime', 'membership', 'gym membership', 'patreon', 'chatgpt',
      'monthly plan', 'assinatura', 'plano mensal']
  },
  {
    id: 'health',
    name: 'Health',
    icon: '💊',
    color: '#00C7BE',
    keywords: [
      'pharmacy', 'drugstore', 'medicine', 'prescription', 'doctor', 'dentist',
      'dental', 'clinic', 'hospital', 'therapy', 'therapist', 'gym', 'vitamins',
      'optician', 'glasses', 'farmacia', 'farmácia', 'drogaria', 'medico', 'médico',
      'dentista', 'clinica', 'clínica', 'laboratorio', 'laboratório', 'exame',
      'academia', 'consulta', 'remedio', 'remédio']
  },
  {
    id: 'entertainment',
    name: 'Entertainment',
    icon: '🍿',
    color: '#FFCC00',
    keywords: [
      'movie', 'movies', 'cinema', 'concert', 'show', 'theater', 'theatre', 'game',
      'games', 'gaming', 'museum', 'club', 'festival', 'tickets', 'book', 'bowling',
      'ingresso', 'teatro', 'balada', 'jogo', 'parque']
  },
  {
    id: 'travel',
    name: 'Travel',
    icon: '✈️',
    color: '#30B0C7',
    keywords: [
      'flight', 'flights', 'airline', 'hotel', 'hostel', 'airbnb', 'booking',
      'luggage', 'vacation', 'holiday', 'rental car', 'car rental', 'passagem aerea',
      'passagem aérea', 'pousada', 'hospedagem', 'viagem', 'aeroporto']
  },
  {
    id: 'home',
    name: 'Home',
    icon: '🏠',
    color: '#32ADE6',
    keywords: [
      'furniture', 'hardware', 'ikea', 'cleaning', 'laundry', 'repair', 'plumber',
      'electrician', 'decor', 'garden', 'tools', 'paint', 'moveis', 'móveis',
      'construcao', 'construção', 'material de construcao', 'ferragem', 'lavanderia',
      'limpeza', 'reforma', 'marcenaria']
  },
  {
    id: 'education',
    name: 'Education',
    icon: '📚',
    color: '#0A84FF',
    keywords: [
      'course', 'class', 'tuition', 'textbook', 'school', 'university', 'training',
      'workshop', 'certification', 'curso', 'faculdade', 'escola',
      'mensalidade escolar', 'apostila']
  },
  {
    id: 'gifts',
    name: 'Gifts',
    icon: '🎁',
    color: '#FF6482',
    keywords: [
      'gift', 'gifts', 'present', 'birthday', 'wedding', 'donation', 'charity',
      'flowers', 'presente', 'floricultura', 'flores', 'doacao', 'doação']
  },
  {
    id: 'other',
    name: 'Other',
    icon: '🗂️',
    color: '#8E8E93',
    keywords: [
]
  }
];

const BY_ID = new Map(CATEGORIES.map((category) => [category.id, category]));

/** @param {string} id */
export function category(id) {
  return BY_ID.get(id) ?? BY_ID.get('other');
}

export function categoryName(id) {
  return category(id).name;
}

export function categoryColor(id) {
  return category(id).color;
}

export function categoryIcon(id) {
  return category(id).icon;
}

/** How an expense got in. Mirrors ExpenseSource.swift. */
export const SOURCES = {
  manual: { id: 'manual', name: 'Manual', icon: '✏️', automatic: false },
  voice: { id: 'voice', name: 'Voice', icon: '🎙️', automatic: false },
  // Not automatic, despite a machine having read the pixels: every screenshot
  // row is confirmed by hand in the review sheet before it is saved, and the
  // sheet already shows which ones look like something you have. Marking it
  // automatic would put a second, silent de-duplication after that decision
  // and quietly swallow the row you just chose to keep.
  screenshot: { id: 'screenshot', name: 'Screenshot', icon: '📸', automatic: false },
  // The id is persisted and stays as it is. The label covers both automations
  // that feed it: the Apple Pay transaction trigger and, since iOS 27, the
  // bank's own purchase notification — "Apple Pay" was wrong for the second.
  cardAutomation: { id: 'cardAutomation', name: 'Card', icon: '💳', automatic: true },
  bankSync: { id: 'bankSync', name: 'Bank', icon: '🏦', automatic: true }
};

export function source(id) {
  return SOURCES[id] ?? SOURCES.manual;
}

/**
 * True for rows a machine produced rather than a person.
 *
 * Only these participate in fuzzy de-duplication: two automatic feeds
 * describing one purchase should collapse, but two entries a person made
 * deliberately should not, however alike they look.
 */
export function isAutomaticSource(id) {
  return source(id).automatic;
}
