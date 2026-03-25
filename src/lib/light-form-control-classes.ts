import { FLOATING_SOLID_PANEL_CLASS } from "@/lib/portal-floating-surface";

/**
 * Jednotný světlý styl pro input / textarea / select trigger (i v dark režimu root HTML).
 * Zelený focus ring dle specifikace portálu.
 */
export const LIGHT_FORM_CONTROL_CLASS =
  "flex w-full min-h-[44px] rounded-md border border-gray-300 !bg-white !text-black px-3 py-2 text-base shadow-sm " +
  "placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-0 " +
  "disabled:cursor-not-allowed disabled:opacity-60 md:min-h-10 md:text-sm " +
  "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-black";

/** Nativní <select> (kde není Radix Select). */
export const NATIVE_SELECT_CLASS = `${LIGHT_FORM_CONTROL_CLASS} appearance-none cursor-pointer`;

/** SelectTrigger: zarovnání barvy hodnoty s textem pole. */
export const LIGHT_SELECT_TRIGGER_CLASS =
  `${LIGHT_FORM_CONTROL_CLASS} items-center justify-between gap-2 [&>span]:line-clamp-1 [&>span]:!text-black`;

/** Rozbalovací seznam selectu (Radix). */
export const LIGHT_SELECT_CONTENT_CLASS = `${FLOATING_SOLID_PANEL_CLASS} !bg-white !text-black`;
