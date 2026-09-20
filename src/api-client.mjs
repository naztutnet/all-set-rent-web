import { inventoryProducts } from "./inventory.mjs?v=6";

const configuredRoot = document.querySelector('meta[name="allset-api"]')?.content?.trim();
const storedRoot = localStorage.getItem("allset-api-root")?.trim();
export const apiRoot = (configuredRoot || storedRoot || "").replace(/\/$/, "");

function normalizeCatalog(payload) {
  const items = Array.isArray(payload) ? payload : payload?.items;
  if (!Array.isArray(items)) throw new Error("API вернул каталог в неизвестном формате");
  return items;
}

export async function loadAdminCatalog({ signal } = {}) {
  if (!apiRoot) {
    return { items: inventoryProducts, mode: "demo", message: "API Бот-Склада ещё не подключён" };
  }

  try {
    const response = await fetch(`${apiRoot}/api/v1/admin/catalog`, {
      credentials: "include",
      headers: { Accept: "application/json" },
      signal,
    });
    if (!response.ok) throw new Error(`API ответил ${response.status}`);
    return { items: normalizeCatalog(await response.json()), mode: "live", message: "Данные получены из Бот-Склада" };
  } catch (error) {
    if (error.name === "AbortError") throw error;
    return {
      items: inventoryProducts,
      mode: "fallback",
      message: `Бот-Склад недоступен: ${error.message}. Показана локальная опись.`,
    };
  }
}
