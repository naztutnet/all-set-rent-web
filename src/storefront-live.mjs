// Витрина на живых данных Бот-Склада: каталог, цены, наличие на даты, заявка.
// Склад отдаёт позиции со своими ID и названиями из таблицы. Фото и категории
// витрины подбираются по названию из описи сайта (inventory.mjs): так карточки
// остаются оформленными, а цифры приходят из склада.

const SHEET_CATEGORY = {
  "мебель": "furniture",
  "шатры": "shelter",
  "освещение": "light",
  "климат": "climate",
  "электрика": "power",
  "генераторы": "power",
  "расходники": "consumables",
};

// Внутри «Электрооборудования» и «Прочего» склад смешивает разное: раскладываем
// по ключевым словам названия, чтобы клиент нашёл кофемашину в «Быте», а не в «Электрике».
const KEYWORD_CATEGORY = [
  [/кофе|чайник|термопо|холодильник|микроволнов|кулер|ледогенер|отпарив|гладил/, "catering"],
  [/принтер|мфу|канцеляр|пробков/, "office"],
  [/телевиз|рация|интерком|громкоговор|акустич|модем|переходник/, "media"],
  [/дым|хейзер/, "effects"],
  [/зарядн|бесперебой|удлинит|фильтр|катушк|генератор/, "power"],
  [/каска|жилет|конус|вешки|вейдерс|ботинк/, "safety"],
];

export const extraCategories = [{ id: "consumables", name: "Расходники", short: "Расходники" }];

const STOP_WORDS = new Set(["м", "мм", "шт", "л", "квт", "с", "на", "для", "без", "и"]);

export function normalizeName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/(\d)\s*[xх×]\s*(\d)/g, "$1x$2")
    .replace(/(\d)([а-яa-z])/g, "$1 $2")
    .replace(/[«»"″'(),:/–—-]+|\.(?!\d)/g, " ")
    .split(/\s+/)
    .filter((token) => token && !STOP_WORDS.has(token));
}

function numbers(tokens) {
  return tokens.filter((token) => /\d/.test(token)).sort().join("|");
}

function similarity(a, b) {
  const left = new Set(a);
  const right = new Set(b);
  let common = 0;
  for (const token of left) if (right.has(token)) common += 1;
  return (2 * common) / (left.size + right.size || 1);
}

// Позиция витрины с тем же смыслом: числа (размеры, мощность) обязаны совпасть,
// иначе шатёр 3×3 получил бы фото шатра 3×6.
export function matchInventory(name, inventory) {
  const tokens = normalizeName(name);
  let best = null;
  let bestScore = 0;
  for (const candidate of inventory) {
    const other = normalizeName(candidate.name);
    if (numbers(tokens) !== numbers(other)) continue;
    const score = similarity(tokens, other);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return bestScore >= 0.6 ? best : null;
}

export function categoryFor(item, matched) {
  if (matched) return matched.category;
  const sheet = String(item.category || "").toLowerCase();
  if (SHEET_CATEGORY[sheet]) return SHEET_CATEGORY[sheet];
  const name = String(item.name || "").toLowerCase();
  for (const [pattern, category] of KEYWORD_CATEGORY) if (pattern.test(name)) return category;
  return "utility";
}

export function toProduct(item, inventory, index) {
  const matched = matchInventory(item.name, inventory);
  return {
    id: item.id,
    name: item.name,
    categoryId: categoryFor(item, matched),
    unit: item.unit || "шт",
    price: Number(item.price_per_day),
    consumable: Boolean(item.consumable),
    image: matched?.image || null,
    aliases: matched ? [matched.name, ...(matched.aliases || [])] : [],
    stock: null,
    catalogIndex: index + 1,
    live: true,
  };
}

// Аренда считается так же, как в складе: цена за сутки × количество × сутки
// включительно. Расходник на срок не умножается.
export function lineTotal(product, quantity, days) {
  if (!Number.isFinite(product.price)) return 0;
  return product.price * quantity * (product.consumable ? 1 : days);
}

export async function detectApi(fetchImpl = globalThis.fetch) {
  const configured = document.querySelector('meta[name="allset-api"]')?.content?.trim();
  const root = (configured || "").replace(/\/$/, "");
  try {
    const response = await fetchImpl(`${root || "."}/api/v1/health`, { signal: AbortSignal.timeout(3000) });
    if (response.ok && (await response.json())?.ok === true) return root || location.origin;
  } catch {
    // склада рядом нет: витрина работает на описи сайта
  }
  return null;
}

export function createStorefront(root, fetchImpl = globalThis.fetch) {
  async function call(path, body) {
    const response = await fetchImpl(`${root}/api/v1/public${path}`, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json", Accept: "application/json" } : { Accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    let answer = null;
    try {
      answer = await response.json();
    } catch {
      answer = null;
    }
    if (!response.ok) {
      const detail = typeof answer?.detail === "string" ? answer.detail : "Склад не ответил. Попробуйте ещё раз.";
      const error = new Error(detail);
      error.status = response.status;
      throw error;
    }
    return answer;
  }
  return {
    catalog: () => call("/catalog").then((body) => body.items),
    availability: (dateOut, dateBack) =>
      call(`/availability?date_out=${encodeURIComponent(dateOut)}&date_back=${encodeURIComponent(dateBack)}`).then((body) => body.free),
    order: (body) => call("/orders", body),
  };
}
