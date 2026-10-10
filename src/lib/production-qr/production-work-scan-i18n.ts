export type WorkScanLang = "cs" | "ua";

export const WORK_SCAN_I18N = {
  cs: {
    brand: "RAJMONDATA VÝROBA",
    taskHeader: "Výrobní úkol",
    readyHeader: "Připraveno pro dalšího pracovníka",
    job: "Zakázka",
    task: "Úkol",
    selectEmployee: "Vyberte zaměstnance",
    pin: "Zadejte PIN",
    pinPlaceholder: "••••",
    start: "Zahájit práci",
    nextWorker: "Další pracovník",
    offline: "Není připojení k serveru. Zkuste to znovu.",
    scanHint:
      "Stejný PIN jako na docházkovém terminálu. Po startu se obrazovka vyčistí pro dalšího pracovníka.",
    successStarted: "Práce spuštěna",
    successAlready: "Úkol už běží",
    prevStopped: "Předchozí úkol ukončen",
    attendanceTitle: "NELZE ZAHÁJIT PRÁCI",
    attendanceNotClocked:
      "Nejste přihlášen na hlavním docházkovém terminálu.\n\nNejdříve se přihlaste do práce na docházkovém terminálu a potom znovu naskenujte QR kód výrobního úkolu.",
    attendanceBreak:
      "Máte přestávku. Nejprve se vraťte do práce na hlavním docházkovém terminálu a potom znovu naskenujte QR kód.",
    attendanceTariff:
      "Nejste v pracovním režimu (oběd / tarif). Nejprve se vraťte k práci na hlavním terminálu a potom znovu naskenujte QR kód.",
    attendanceClockedOut:
      "Docházka je ukončena. Přihlaste se znovu na hlavním terminálu a potom naskenujte QR kód.",
    langCs: "CZ",
    langUa: "UA",
  },
  ua: {
    brand: "RAJMONDATA ВИРОБНИЦТВО",
    taskHeader: "Виробниче завдання",
    readyHeader: "Готово для наступного працівника",
    job: "Замовлення",
    task: "Завдання",
    selectEmployee: "Оберіть працівника",
    pin: "Введіть PIN",
    pinPlaceholder: "••••",
    start: "Розпочати роботу",
    nextWorker: "Наступний працівник",
    offline: "Немає з’єднання з сервером. Спробуйте ще раз.",
    scanHint:
      "Той самий PIN, що на терміналі обліку. Після старту екран очиститься для наступного працівника.",
    successStarted: "Роботу розпочато",
    successAlready: "Завдання вже виконується",
    prevStopped: "Попереднє завдання завершено",
    attendanceTitle: "НЕМОЖЛИВО РОЗПОЧАТИ РОБОТУ",
    attendanceNotClocked:
      "Ви не зареєстрували початок робочого часу на основному терміналі обліку робочого часу.\n\nСпочатку зареєструйте початок роботи на терміналі, а потім повторно відскануйте QR-код виробничого завдання.",
    attendanceBreak:
      "У вас перерва. Спочатку поверніться до роботи на основному терміналі, потім знову відскануйте QR-код.",
    attendanceTariff:
      "Ви не в робочому режимі (обід / тариф). Спочатку поверніться до роботи на терміналі, потім знову відскануйте QR-код.",
    attendanceClockedOut:
      "Облік робочого часу завершено. Знову увійдіть на основному терміналі та відскануйте QR-код.",
    langCs: "CZ",
    langUa: "UA",
  },
} as const;

export function attendanceMessageForCode(
  lang: WorkScanLang,
  code: string | undefined
): string {
  const L = WORK_SCAN_I18N[lang];
  switch (code) {
    case "ON_BREAK":
      return L.attendanceBreak;
    case "NON_WORKING_TARIFF":
      return L.attendanceTariff;
    case "CLOCKED_OUT":
      return L.attendanceClockedOut;
    case "NOT_CLOCKED_IN":
    default:
      return L.attendanceNotClocked;
  }
}
