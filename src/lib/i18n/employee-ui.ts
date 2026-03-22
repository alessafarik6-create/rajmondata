/**
 * Jednoduché překlady pro zaměstnaneckou část portálu (bez externí knihovny).
 */

export type EmployeeUiLang = "cs" | "ua";

export function normalizeEmployeeUiLang(raw: unknown): EmployeeUiLang {
  return raw === "ua" ? "ua" : "cs";
}

const translations = {
  cs: {
    login: "Přihlásit se",
    workReport: "Výkaz práce",
    dailyReportMenu: "Denní výkaz",
    attendance: "Docházka",
    home: "Hlavní stránka",
    money: "Peníze",
    profile: "Profil",
    messages: "Zprávy",
    messagesSubtitle: "Napište administrátorovi firmy.",
    employeeSection: "Zaměstnanec",
    loadingAuth: "Ověřujeme přihlášení…",
    loadingProfile: "Načítání profilu…",
    goodDay: "Dobrý den",
    colleague: "kolego",
    hours: "Hodiny",
    today: "Dnes",
    thisWeek: "Tento týden (po–dnes)",
    dayOverview: "Přehled dne",
    checkIn: "Příchod",
    checkOut: "Odchod",
    worked: "Odpracováno",
    status: "Stav",
    noAttendanceToday: "Pro dnešek nemáte v docházce žádné záznamy.",
    loadingAttendance: "Načítám docházku…",
    workDescription: "Popis práce",
    language: "Jazyk rozhraní",
    languageCs: "Čeština",
    languageUa: "Українська",
    saved: "Uloženo",
    save: "Uložit",
  },
  ua: {
    login: "Увійти",
    workReport: "Звіт роботи",
    dailyReportMenu: "Щоденний звіт",
    attendance: "Облік часу",
    home: "Головна",
    money: "Гроші",
    profile: "Профіль",
    messages: "Повідомлення",
    messagesSubtitle: "Напишіть адміністратору компанії.",
    employeeSection: "Працівник",
    loadingAuth: "Перевіряємо вхід…",
    loadingProfile: "Завантаження профілю…",
    goodDay: "Добрий день",
    colleague: "колего",
    hours: "Години",
    today: "Сьогодні",
    thisWeek: "Цей тиждень (пн–сьогодні)",
    dayOverview: "Огляд дня",
    checkIn: "Прихід",
    checkOut: "Вихід",
    worked: "Відпрацьовано",
    status: "Статус",
    noAttendanceToday: "На сьогодні немає записів обліку.",
    loadingAttendance: "Завантажуємо облік…",
    workDescription: "Опис роботи",
    language: "Мова інтерфейсу",
    languageCs: "Чеська",
    languageUa: "Українська",
    saved: "Збережено",
    save: "Зберегти",
  },
} as const;

export type EmployeeUiKey = keyof typeof translations.cs;

export function employeeUiT(
  lang: EmployeeUiLang,
  key: EmployeeUiKey
): string {
  return translations[lang][key] ?? translations.cs[key] ?? key;
}
