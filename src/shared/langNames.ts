// iso639-2 -> display name, shared between the DVD rip pipeline (main, for
// HandBrake --aname track titles) and the player (renderer, for the
// subtitle-availability badge). Falls back to the raw code for anything unlisted.
const LANG_NAMES: Record<string, string> = {
  eng: 'English',
  deu: 'Deutsch',
  ger: 'Deutsch',
  fra: 'Français',
  fre: 'Français',
  ita: 'Italiano',
  spa: 'Español',
  nld: 'Nederlands',
  por: 'Português',
  tur: 'Türkçe',
  rus: 'Русский',
  pol: 'Polski',
  ces: 'Čeština',
  cze: 'Čeština',
  jpn: '日本語',
  kor: '한국어',
  zho: '中文',
  chi: '中文',
  ara: 'العربية'
}

export function langLabel(code: string): string {
  return LANG_NAMES[code] ?? code
}
