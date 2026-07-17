// Marvins Manifest — Quelle der Screensaver-„Untertitel". Wort für Wort
// eingeblendet, max. 3 Worte gleichzeitig im Bild.
const MANIFEST = `
Wir haben aufgehört zu besitzen, ohne es zu merken. Die Werkzeuge, die Musik, die Filme, sogar die Software, mit der wir gestalten, gehören uns nicht mehr. Wir mieten sie. Monat für Monat. Und in dem Moment, in dem wir aufhören zu zahlen, verschwindet alles, als hätte es nie uns gehört.

Das ist kein Versehen. Es ist ein Modell. Zugang hat Besitz ersetzt, und der Wechsel geschah so leise, so bequem, so gut gestaltet, dass wir ihn zunächst für Fortschritt hielten. Kein Regal mehr, keine Datenträger, keine Sorge um Updates. Nur ein Preis, der jeden Monat wiederkommt, und die Zugangsberechtigung, die jemand anderes kontrolliert.

Was wir dabei verlieren, steht auf keiner Rechnung. Wir verlieren die Sicherheit, dass etwas bleibt. Wir verlieren das Recht, ein Ding zu behalten, weiterzugeben, zu reparieren, zu vergessen und wiederzufinden. Wir verlieren die Möglichkeit, nein zu sagen, ohne dass uns etwas genommen wird.

Mir ist wichtig, dass dieser Verlust wieder sichtbar wird. Nicht aus Nostalgie, sondern weil ein Leben, in dem ich nichts mehr behalten darf, ein Leben in dauernder Abhängigkeit ist.

Ändern lässt sich das nicht mit einem großen Bruch, sondern mit kleinen Entscheidungen. Ich frage bei jedem Abo, was passiert, wenn ich kündige. Ich bevorzuge, was ich behalten kann, auch wenn es unbequemer ist. Ich lerne wieder, Dinge selbst zu verwalten, statt sie mir zuteilen zu lassen. Und ich rede darüber, denn das Modell lebt davon, unbemerkt zu bleiben.

Besitz ist kein Luxus. Er ist die Bedingung dafür, dass mir etwas gehört, das mir niemand nehmen kann.
`

/**
 * Zerlegt das Manifest in Gruppen von max. 3 Worten. Satzgrenzen (. ! ?) werden
 * nicht überschritten, damit die Untertitel-Zäsuren am Satzende sitzen.
 */
export function buildGroups(): string[][] {
  const sentences = MANIFEST.trim()
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)

  const groups: string[][] = []
  for (const sentence of sentences) {
    const words = sentence.split(' ').filter(Boolean)
    for (let i = 0; i < words.length; i += 3) {
      groups.push(words.slice(i, i + 3))
    }
  }
  return groups
}

export const GROUPS = buildGroups()
