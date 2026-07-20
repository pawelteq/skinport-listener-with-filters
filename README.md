# Sale Feed Viewer (Skinport)

Aplikacja na żywo śledzi feed sprzedaży **Skinport** (CS2 / app 730) i w czasie rzeczywistym
pokazuje oferty w przeglądarce, porównując ich ceny ze **Steam Community Market**, **CSFloat**
oraz aktualną najniższą ceną na **Skinport**. Wszystkie ceny są przeliczane na wybraną walutę.

![Sale Feed Viewer](docs/screenshot.png)

> Jeśli chcesz pokazać zrzut ekranu w README, wrzuć obraz do folderu `docs/` jako `screenshot.png`.

## Funkcje

- **Live feed** – połączenie WebSocket ze Skinport, nowe oferty pojawiają się natychmiast.
- **Porównanie cen** z trzech źródeł na jednej karcie:
  - **Skinport** – cena tej oferty + najniższa cena na rynku (z liczbą ofert),
  - **Steam** – najniższa cena + mediana,
  - **CSFloat** – najniższa cena.
- **Najtańsze źródło na zielono**, pozostałe na czerwono – od razu widać, gdzie kupić taniej.
- **Wybór waluty** (PLN / EUR / USD / GBP) – wszystkie ceny przeliczane wg aktualnych kursów (EBC).
- **Filtr minimalnej zniżki (%)**.
- **Bezpośrednie linki** do przedmiotu na Skinport, Steam i CSFloat.
- Responsywny układ kart (więcej kolumn na szerszych ekranach).

## Wymagania

- [Node.js](https://nodejs.org/) w wersji **18+** (zalecane 20+).
- Połączenie z internetem (API Skinport, Steam, CSFloat oraz kursów walut).

## Instalacja

```bash
git clone https://github.com/<twoja-nazwa>/skinport-sale-feed.git
cd skinport-sale-feed
npm install
```

## Konfiguracja

Skopiuj `.env.example` do `.env` i uzupełnij wartości:

```bash
cp .env.example .env
```

| Zmienna             | Opis                                                                 | Domyślnie |
|---------------------|----------------------------------------------------------------------|-----------|
| `PORT`              | Port serwera HTTP.                                                    | `3000`    |
| `CSFLOAT_API_KEY`   | Klucz API CSFloat. Bez niego CSFloat często zwraca **HTTP 429**.      | brak      |

Klucz CSFloat wygenerujesz w ustawieniach konta na [csfloat.com](https://csfloat.com).

## Uruchomienie

```bash
npm start
```

Następnie otwórz w przeglądarce:

```
http://localhost:3000
```

## Jak to działa

```
Skinport WebSocket  ──►  serwer Node.js (main.js)  ──►  przeglądarka (public/)
                          │
                          ├─ Steam priceoverview API   (najniższa + mediana)
                          ├─ CSFloat listings API       (najniższa)
                          ├─ Skinport items API         (najniższa rynkowa + link)
                          └─ kursy walut (frankfurter.app, baza EUR)
```

- `main.js` – serwer Express + Socket.IO. Łączy się z feedem Skinport, wzbogaca każdą ofertę
  o ceny porównawcze i rozsyła je do przeglądarek. Kursy walut odświeżane są co godzinę,
  katalog Skinport cache'owany jest przez 5 minut (limit API).
- `public/index.html` – interfejs i style.
- `public/client.js` – logika frontu: render kart, przeliczanie walut, kolorowanie źródeł.
- `msgpack-parser.js` – parser msgpack dla połączenia Socket.IO ze Skinport.

## Struktura projektu

```
.
├── main.js              # serwer (feed + API porównawcze + kursy walut)
├── msgpack-parser.js    # parser komunikacji ze Skinport
├── public/
│   ├── index.html       # UI + style
│   └── client.js        # logika frontendu
├── package.json
├── .env.example         # przykładowa konfiguracja
└── .gitignore
```

## Uwagi i ograniczenia

- **CSFloat – HTTP 429**: API CSFloat ma niski limit zapytań. Ustaw `CSFLOAT_API_KEY`
  i/lub ogranicz liczbę równoległych zapytań, jeśli pojawia się błąd 429.
- **Steam – HTTP 429**: Steam również limituje `priceoverview`; przy dużym ruchu ofert
  część zapytań może wracać z błędem.
- **Przeliczanie walut**: kursy z [frankfurter.app](https://www.frankfurter.app) (dane EBC,
  baza EUR). CSFloat podaje ceny w USD i są przeliczane na wybraną walutę.

## Licencja

Projekt do użytku własnego / edukacyjnego. Dodaj wybraną licencję (np. MIT), jeśli chcesz
udostępnić go publicznie.

---

Projekt nie jest powiązany ani wspierany przez Skinport, Valve/Steam ani CSFloat.
Nazwy i znaki towarowe należą do ich właścicieli.
