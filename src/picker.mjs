// Подбор под проект: сколько человек, где снимаем, ночь, сезон по датам.
// Правила — черновик для обсуждения с командой. Все цифры живут здесь, в одной
// таблице RULES: правится строка, подбор меняется.
//
// Каждое правило: позиция склада и сколько её нужно на группу. `per` — один
// предмет на столько человек, `min` — не меньше, `fixed` — ровно столько.
// `when` — в каких условиях правило включается.

export const SEASONS = {
  winter: "зима",
  offseason: "межсезонье",
  summer: "лето",
};

export function seasonOf(dateText) {
  const month = Number(String(dateText || "").slice(5, 7));
  if ([11, 12, 1, 2, 3].includes(month)) return "winter";
  if ([6, 7, 8].includes(month)) return "summer";
  return "offseason";
}

const RAINY_MONTHS = [4, 5, 9, 10];

export const RULES = [
  // Базовый быт площадки
  { id: "ITM-0020", why: "стулья: сидят не все сразу", share: 0.6, min: 6 },
  { id: "ITM-0018", why: "режиссёрские стулья", per: 50, min: 2, plus: 1 },
  { id: "ITM-0015", why: "столы под еду и работу", per: 10, min: 2 },
  { id: "ITM-0027", why: "шатёр под зону отдыха и еды", per: 30, min: 1, when: { location: "nature" } },
  { id: "ITM-0024", why: "водослив к шатру в дождливый сезон", per: 30, min: 1, when: { location: "nature", rainy: true } },
  { id: "ITM-0070", why: "кулер", per: 40, min: 1 },
  { id: "ITM-0085", why: "чайник", per: 40, min: 1 },
  // Связь
  { id: "ITM-0077", why: "рации: одна на 6 человек", per: 6, min: 4 },
  { id: "ITM-0056", why: "зарядка для раций", per: 60, min: 1 },
  // Электрика
  { id: "ITM-0030", why: "кабель до розетки", per: 40, min: 2, when: { location: "nature" } },
  { id: "ITM-0030", why: "кабель внутри павильона", fixed: 1, when: { location: "studio" } },
  { id: "ITM-0034", why: "сетевые фильтры", per: 15, min: 2 },
  // Холод
  { id: "ITM-0055", why: "тепловые пушки 9 кВт", per: 40, min: 1, when: { season: "winter", location: "nature" } },
  { id: "ITM-0049", why: "инфракрасные обогреватели", per: 30, min: 1, when: { season: "winter" } },
  { id: "ITM-0108", why: "пледы", share: 0.3, min: 5, when: { season: "winter", location: "nature" } },
  { id: "ITM-0054", why: "пушки 5 кВт на прохладные вечера", per: 50, min: 1, when: { season: "offseason", location: "nature" } },
  // Жара
  { id: "ITM-0047", why: "вентиляторы", per: 25, min: 1, when: { season: "summer" } },
  { id: "ITM-0026", why: "шатёр 3×3 для тени", per: 40, min: 1, when: { season: "summer", location: "nature" } },
  // Ночь
  { id: "ITM-0043", why: "прожекторы на штативе", per: 25, min: 2, when: { night: true, location: "nature" } },
  { id: "ITM-0041", why: "налобные фонари", per: 5, min: 4, when: { night: true } },
  // Расходники на всю съёмку
  { id: "ITM-0124", why: "мусорные мешки, 1 на 10 человек в смену", per: 10, min: 2, perShift: true },
  { id: "ITM-0122", why: "дождевики одноразовые", share: 0.5, min: 10, when: { location: "nature", rainy: true } },
];

export const VARIANTS = [
  { id: "min", name: "Минимум", factor: 0.75, note: "самое нужное, без запаса" },
  { id: "opt", name: "Оптимально", factor: 1, note: "как обычно собирают площадку" },
  { id: "max", name: "С запасом", factor: 1.3, note: "запас на поломки и рост группы" },
];

function applies(rule, context) {
  const when = rule.when || {};
  if (when.location && when.location !== context.location) return false;
  if (when.season && when.season !== context.season) return false;
  if (when.night && !context.night) return false;
  if (when.rainy && !context.rainy) return false;
  return true;
}

function quantity(rule, people, factor, shifts) {
  if (rule.fixed) return rule.fixed;
  let qty = rule.share ? people * rule.share : people / rule.per;
  qty = Math.ceil(qty * factor) + (rule.plus || 0);
  qty = Math.max(qty, rule.min || 1);
  return rule.perShift ? qty * shifts : qty;
}

export function contextFor({ people, location, night, dateOut, dateBack }) {
  const month = Number(String(dateOut || "").slice(5, 7));
  const start = new Date(`${dateOut}T12:00:00`);
  const end = new Date(`${dateBack}T12:00:00`);
  const shifts = Math.max(1, Math.round((end - start) / 86400000) + 1);
  return {
    people: Math.min(Math.max(Math.round(Number(people) || 0), 5), 400),
    location: location === "studio" ? "studio" : "nature",
    night: Boolean(night),
    season: seasonOf(dateOut),
    rainy: RAINY_MONTHS.includes(month),
    shifts,
  };
}

// Варианты набора. `products` — позиции склада по ID (цена, расходник), `free` —
// сколько свободно на даты. Позиции, которых нет на складе, честно пропускаются,
// нехватка видна в каждом варианте.
export function buildVariants(input, products, free = {}) {
  const context = contextFor(input);
  return VARIANTS.map((variant) => {
    const merged = new Map();
    for (const rule of RULES) {
      if (!applies(rule, context)) continue;
      const product = products.get(rule.id);
      if (!product) continue;
      const qty = quantity(rule, context.people, variant.factor, context.shifts);
      const row = merged.get(rule.id) || { product, qty: 0, why: [] };
      row.qty += qty;
      row.why.push(rule.why);
      merged.set(rule.id, row);
    }
    const rows = [...merged.values()].map((row) => ({
      ...row,
      free: free[row.product.id],
      short: free[row.product.id] !== undefined && row.qty > free[row.product.id],
    }));
    const days = context.shifts;
    const total = rows.reduce(
      (sum, row) => sum + row.product.price * row.qty * (row.product.consumable ? 1 : days),
      0,
    );
    return { ...variant, context, rows, total, short: rows.filter((row) => row.short) };
  });
}

export function describeContext(context) {
  const parts = [
    `${context.people} человек`,
    context.location === "studio" ? "павильон" : "натура",
    `${context.shifts} ${context.shifts === 1 ? "смена" : context.shifts < 5 ? "смены" : "смен"}`,
    SEASONS[context.season],
  ];
  if (context.night) parts.push("ночь");
  if (context.rainy && context.location === "nature") parts.push("сезон дождей");
  return parts.join(" · ");
}
