export const products = [
  {
    id: "chair-director",
    name: "Кресло режиссёрское",
    category: "Мебель",
    price: 650,
    unit: "шт. / смена",
    stock: 46,
    tag: "На площадку",
    image: "assets/catalog/chair-kopatych.webp",
    tone: "cobalt",
  },
  {
    id: "tent-3x6",
    name: "Шатёр PRO 3×6 м",
    category: "Шатры",
    price: 7800,
    unit: "шт. / смена",
    stock: 8,
    tag: "Монтаж включён",
    image: "assets/catalog/tent-3x6.webp",
    tone: "sky",
  },
  {
    id: "heater-diesel",
    name: "Тепловая пушка 30 кВт",
    category: "Климат",
    price: 4200,
    unit: "шт. / смена",
    stock: 12,
    tag: "Зимняя смена",
    image: "assets/catalog/heater-diesel.webp",
    tone: "orange",
  },
  {
    id: "radio-motorola",
    name: "Рация Motorola DP1400",
    category: "Связь",
    price: 900,
    unit: "шт. / смена",
    stock: 78,
    tag: "Заряжена",
    image: "assets/catalog/radio-motorola.webp",
    tone: "graphite",
  },
  {
    id: "table-folding",
    name: "Стол складной 180 см",
    category: "Мебель",
    price: 850,
    unit: "шт. / смена",
    stock: 34,
    tag: "Быстрая сборка",
    image: "assets/catalog/table-folding.webp",
    tone: "mint",
  },
  {
    id: "makeup-mirror",
    name: "Гримерное зеркало",
    category: "Грим",
    price: 2400,
    unit: "шт. / смена",
    stock: 15,
    tag: "С подсветкой",
    image: "assets/catalog/makeup-mirror.webp",
    tone: "rose",
  },
  {
    id: "power-station",
    name: "Зарядная станция 2 кВт",
    category: "Питание",
    price: 5400,
    unit: "шт. / смена",
    stock: 9,
    tag: "Тихая работа",
    image: "assets/catalog/power-station.webp",
    tone: "yellow",
  },
  {
    id: "rack-costume",
    name: "Рейл усиленный",
    category: "Костюм",
    price: 1100,
    unit: "шт. / смена",
    stock: 24,
    tag: "До 80 кг",
    image: "assets/catalog/rack-costume.webp",
    tone: "lilac",
  },
];

export const kits = [
  {
    id: "base-30",
    name: "База на 30 человек",
    label: "Дневная смена · 12 часов",
    description: "Штаб, питание, связь и базовый комфорт команды.",
    itemIds: ["tent-3x6", "chair-director", "table-folding", "radio-motorola"],
    quantities: [2, 8, 5, 8],
    price: 43200,
    accent: "blue",
  },
  {
    id: "night-shift",
    name: "Ночная смена",
    label: "До −10 °C · 12 часов",
    description: "Тёплый штаб, автономное питание и связь для ночной площадки.",
    itemIds: ["tent-3x6", "heater-diesel", "power-station", "radio-motorola"],
    quantities: [2, 2, 1, 10],
    price: 51900,
    accent: "night",
  },
  {
    id: "makeup-zone",
    name: "Гримёрная зона",
    label: "До 12 актёров",
    description: "Рабочие места, зеркала, рейлы и отдельный шатёр.",
    itemIds: ["tent-3x6", "makeup-mirror", "chair-director", "rack-costume"],
    quantities: [1, 4, 4, 3],
    price: 25800,
    accent: "peach",
  },
];

export function rentalDays(start, end) {
  if (!start || !end) return 1;
  const startDate = new Date(`${start}T12:00:00`);
  const endDate = new Date(`${end}T12:00:00`);
  const diff = Math.round((endDate - startDate) / 86_400_000) + 1;
  return Math.max(1, diff);
}

export function discountForDays(days) {
  if (days >= 31) return 0.45;
  if (days >= 15) return 0.3;
  if (days >= 8) return 0.2;
  if (days >= 4) return 0.1;
  return 0;
}

export function itemTotal(price, quantity, days) {
  return Math.round(price * quantity * days * (1 - discountForDays(days)));
}

export function estimate(cart, start, end) {
  const days = rentalDays(start, end);
  const subtotal = cart.reduce(
    (sum, item) => sum + itemTotal(item.price, item.quantity, days),
    0,
  );
  const delivery = cart.length ? 5900 : 0;
  const service = cart.length ? Math.round(subtotal * 0.02) : 0;
  return {
    days,
    discount: discountForDays(days),
    subtotal,
    delivery,
    service,
    total: subtotal + delivery + service,
  };
}

export function formatMoney(value) {
  if (!Number.isFinite(value)) return "по запросу";
  return new Intl.NumberFormat("ru-RU").format(value) + " ₽";
}
