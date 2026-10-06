# WebHandbrake — Documento di raccolta dei requisiti

| Campo | Valore |
|---|---|
| Progetto | WebHandbrake — estensione open source per l'autoregolazione della navigazione |
| Piattaforme target | Firefox desktop, Firefox per Android, Google Chrome (e derivati Chromium) |
| Documento | Specifica dei requisiti (SRS) — raccolta e analisi |
| Versione | 0.1 (bozza per revisione) |
| Data | 2026-10-04 |
| Stato | Da validare con gli stakeholder |

> **In una frase.** WebHandbrake è un "freno a mano" per il web: aiuta le persone a usare i siti che scelgono *quando* e *quanto* hanno deciso, privilegiando la frizione graduata (rallentare, chiedere, ricordare) rispetto al muro, con protezioni serie contro l'autoelusione, tutto in locale e senza telemetria.

---

## Indice

1. [Introduzione](#1-introduzione)
2. [Metodologia e fonti](#2-metodologia-e-fonti)
3. [Analisi dello stato dell'arte](#3-analisi-dello-stato-dellarte)
   - 3.1 [Inventario funzionale della categoria](#31-inventario-funzionale-della-categoria)
   - 3.2 [Problemi noti e richieste non soddisfatte](#32-problemi-noti-e-richieste-non-soddisfatte)
   - 3.3 [Estensioni e app concorrenti](#33-estensioni-e-app-concorrenti)
   - 3.4 [Idee da domini adiacenti](#34-idee-da-domini-adiacenti)
   - 3.5 [Evidenze scientifiche](#35-evidenze-scientifiche)
   - 3.6 [Vincoli tecnici della piattaforma](#36-vincoli-tecnici-della-piattaforma)
4. [Visione di prodotto e principi di design](#4-visione-di-prodotto-e-principi-di-design)
5. [Stakeholder, personas e scenari](#5-stakeholder-personas-e-scenari)
6. [Requisiti funzionali](#6-requisiti-funzionali)
7. [Requisiti non funzionali](#7-requisiti-non-funzionali)
8. [Architettura dell'interfaccia utente proposta](#8-architettura-dellinterfaccia-utente-proposta)
9. [Roadmap e perimetro dei rilasci](#9-roadmap-e-perimetro-dei-rilasci)
10. [Fuori ambito](#10-fuori-ambito)
11. [Rischi e mitigazioni](#11-rischi-e-mitigazioni)
12. [Decisioni aperte](#12-decisioni-aperte)
13. [Criteri di accettazione esemplari](#13-criteri-di-accettazione-esemplari)
14. [Tracciabilità delle richieste degli utenti](#14-tracciabilità-delle-richieste-degli-utenti)
- [Appendice A — Vettori di elusione e contromisure](#appendice-a--vettori-di-elusione-e-contromisure)
- [Appendice B — Compatibilità delle API WebExtension](#appendice-b--compatibilità-delle-api-webextension)
- [Appendice C — Bibliografia e fonti](#appendice-c--bibliografia-e-fonti)

---

## 1. Introduzione

### 1.1 Scopo del documento

Questo documento raccoglie, motiva e prioritizza i requisiti di WebHandbrake. È basato su:

- un inventario delle funzioni offerte dalle **estensioni e app esistenti** della categoria;
- l'analisi di **issue, discussioni e recensioni** di queste estensioni, per capire cosa viene chiesto e non è ancora implementato, e quali problemi restano aperti;
- l'analisi della **letteratura scientifica** (HCI, psicologia dell'autocontrollo, economia comportamentale) sugli strumenti di autocontrollo digitale;
- funzioni di prodotti di **domini adiacenti** che avrebbero senso in un'estensione di blocco;
- i **vincoli tecnici** reali di Manifest V3 e di Firefox per Android.

Il documento è pensato come base per la progettazione e lo sviluppo, per la pubblicazione su GitHub (README, roadmap, issue) e per la revisione da parte di futuri contributori.

### 1.2 Ambito

**In ambito (v1):** estensione per browser che limita, rallenta o blocca l'accesso a siti, pagine ed elementi di pagina in base a pianificazioni, limiti di tempo e di visite, sessioni di concentrazione; offre interventi graduati, protezioni anti-elusione, statistiche locali, import/export e un'interfaccia accessibile su desktop e mobile.

**Fuori ambito (v1):** sincronizzazione tra dispositivi (prevista dalla v2, con architettura predisposta fin da subito), blocco di app native o di altri browser, controllo parentale come caso d'uso primario, qualsiasi servizio server. Vedi [§10](#10-fuori-ambito).

### 1.3 Vincoli di progetto dichiarati

| ID | Vincolo |
|---|---|
| VIN-01 | Open source, pubblicato su GitHub. |
| VIN-02 | **Local-first**: tutti i dati restano sul dispositivo; nessun account, nessun server del progetto. |
| VIN-03 | **Privacy by design**: zero telemetria, nessuna richiesta di rete non avviata esplicitamente dall'utente. |
| VIN-04 | Supporto a Firefox desktop, **Firefox per Android** e Chrome (Chromium) con un'unica base di codice. |
| VIN-05 | Nessuna sincronizzazione tra dispositivi nella prima versione. |

### 1.4 Convenzioni

**Identificativi.** `AREA-NN` (es. `MAT-04`). Le aree sono elencate in [§6](#6-requisiti-funzionali) e [§7](#7-requisiti-non-funzionali).

**Priorità (MoSCoW).**
- **M** (Must): indispensabile per il rilascio indicato.
- **S** (Should): importante, si rinvia solo con una motivazione.
- **C** (Could): desiderabile, se c'è capacità.
- **W** (Won't, per ora): esplicitamente escluso dal perimetro corrente.

**Rilascio target.**
- **R1** = v1.0 (MVP).
- **R2** = v1.x (funzioni differenzianti).
- **R3** = v2.x (sincronizzazione e funzioni che dipendono da essa).
- **F** = futuro / da ricercare.

**Riferimenti alle fonti** (dettaglio in [Appendice C](#appendice-c--bibliografia-e-fonti)):
- `GH` = issue e discussioni pubbliche (GitHub) delle estensioni open source analizzate.
- `Doc` = documentazione, FAQ ed esempi dei prodotti esistenti.
- `AMO:<estensione>` = recensioni su addons.mozilla.org.
- `HN` = commenti su Hacker News.
- `[Pn]` = paper scientifico; `[Xn]` = fonte da dominio adiacente; `[Tn]` = fonte tecnica.

### 1.5 Glossario

| Termine | Definizione |
|---|---|
| **Gruppo** | Insieme di siti trattati con le stesse regole (nell'interfaccia: *regola*). Ha nome, colore, nota motivazionale, target, policy e livello di protezione. |
| **Target** | Elemento che identifica cosa colpire: dominio, host, percorso, pattern, regex, parola chiave, referrer, categoria. |
| **Eccezione** | Target in modalità "consenti" all'interno di un gruppo. |
| **Policy** | Coppia *condizione → intervento* all'interno di un gruppo (es. "Lun–Ven 9–17 → blocco"; "dopo 30 min/giorno → ritardo 30 s"). |
| **Finestra** | Intervallo orario ricorrente (anche a cavallo della mezzanotte). |
| **Budget** | Quantità consumabile in un periodo: minuti, visite, sessioni, pause. |
| **Intervento** | Ciò che accade quando una policy si applica: promemoria, filtro, domanda d'intenzione, ritardo, sfida, blocco, chiusura, reindirizzamento. |
| **Frizione** | Costo deliberato (tempo, fatica, riflessione) inserito prima di un'azione. |
| **Pausa** (*override*) | Sospensione temporanea, limitata e tracciata, di uno o più interventi. |
| **Sessione focus** | Periodo a tempo durante cui uno o più gruppi (o "tutto tranne una allowlist") sono bloccati. |
| **Protezione** | Insieme dei meccanismi che rendono più difficile indebolire le proprie regole. |
| **Rafforzamento / indebolimento** | Modifica che rende le regole più restrittive (es. aggiungere un sito) / meno restrittive (es. rimuoverlo). |
| **Cooling-off** | Periodo di attesa obbligatorio tra la richiesta di un indebolimento e la sua applicazione, seguito da una conferma esplicita. |
| **DNR** | `declarativeNetRequest`, API per bloccare o reindirizzare richieste di rete in modo dichiarativo (MV3). |

---

## 2. Metodologia e fonti

L'analisi è stata svolta il 2026-10-04 incrociando fonti primarie e secondarie.

| Fonte | Cosa è stato analizzato | Volume |
|---|---|---|
| Documentazione dei prodotti esistenti | Opzioni, FAQ ed esempi delle estensioni analizzate | Integrale per le funzioni rilevanti |
| Issue e discussioni pubbliche (GitHub) | Issue aperte e chiuse e discussioni *Ideas* e *Q&A* delle principali estensioni open source della categoria, ordinate per reazioni e commenti | oltre 800 elementi |
| addons.mozilla.org (API pubblica) | Metadati e recensioni da 1 a 3 stelle di Block Site, BlockSite, Impulse Blocker, Freedom, one sec, News Feed Eradicator, StayFree, Time Tracker, Forest, SocialFocus, uBlacklist, DF YouTube, Unhook | 13 estensioni, circa 300 recensioni testuali |
| Store e siti dei concorrenti | Cold Turkey, StayFocusd, BlockSite, Freedom, Intention, ScreenZen, Dopanope, Mindful, HabitLab, Time Tracker | 12 prodotti |
| Hacker News (API Algolia) | Commenti su blocker, Cold Turkey, StayFocusd, frizione | 1.445 commenti raccolti, 485 pertinenti |
| Letteratura scientifica | Review sistematiche, meta-analisi, studi sul campo e controllati | circa 30 paper (vedi [§3.5](#35-evidenze-scientifiche)) |
| Documentazione tecnica | MDN browser-compat-data 8.1.4 (2026-10-01), documentazione Chrome su DNR e ciclo di vita dei service worker | Integrale per le API rilevanti |

**Limiti dell'analisi.**
- Le recensioni del Chrome Web Store non sono accessibili in modo strutturato; sono state usate solo in minima parte. Il quadro "Chrome" deriva soprattutto dalle issue dei port per Chrome delle estensioni analizzate e da HN.
- Reddit non è interrogabile da questo ambiente; HN e le discussioni GitHub ne coprono in parte i temi.
- Le evidenze scientifiche provengono soprattutto da studi su smartphone. La trasferibilità al browser desktop è plausibile ma non sempre dimostrata. Dove serve, lo segnaliamo.

---

## 3. Analisi dello stato dell'arte

### 3.1 Inventario funzionale della categoria

Le estensioni di blocco più diffuse, open source e commerciali, offrono un insieme di funzioni ormai consolidato. La tabella riassume ciò che un utente si aspetta di trovare; i limiti più ricorrenti sono descritti in §3.2.

| Area | Funzioni comuni nella categoria |
|---|---|
| **Organizzazione** | Più insiemi di siti, ciascuno con nome e regole proprie, riordinabili e disattivabili. |
| **Cosa bloccare** | Domini con o senza sottodomini, percorsi e pagine; wildcard; eccezioni; parole chiave nell'URL o nel titolo; commenti nelle liste; file locali; espressioni regolari nelle varianti avanzate; caricamento di liste da un URL. |
| **Quando** | Fasce orarie e giorni della settimana; limiti di tempo per periodo; combinazione di fasce e limiti; conteggio solo sulla tab attiva o con audio; recupero del tempo non usato. |
| **Come bloccare** | Pagina di blocco con messaggio personalizzabile, pagina di attesa con countdown, reindirizzamento, chiusura della tab, filtri visivi (scala di grigi, sfocatura) al posto del blocco, blocco limitato alle finestre private o normali. |
| **Sessioni** | Blocco immediato per una durata scelta, spesso non annullabile, con o senza allowlist. |
| **Pause** | Sospensione temporanea con durata e numero limitati, protetta da password o da un testo da digitare. |
| **Protezione** | Password o testo casuale per accedere alle impostazioni; fasce in cui le impostazioni sono bloccate; blocco delle pagine di gestione delle estensioni; prevenzione della disinstallazione nelle app desktop. |
| **Feedback** | Timer sovrapposto alla pagina, badge sull'icona, avviso prima del blocco, statistiche di base. |
| **Dati e varie** | Esportazione e importazione, sincronizzazione nelle versioni commerciali, temi, CSS personalizzato per le pagine di blocco, menu contestuale, scorciatoie da tastiera. |

**Punti di forza da preservare.** Granularità a livello di pagina e percorso; il ritardo (citato più volte su HN come la funzione più efficace: *"that small extra friction is enough to break the habit"*); la combinazione di fasce e limiti; pause limitate e con un costo; blocco delle pagine interne del browser; nessuna raccolta dati nelle estensioni open source.

### 3.2 Problemi noti e richieste non soddisfatte

#### 3.2.1 Problemi ricorrenti

| Tema | Evidenze | Implicazione per WebHandbrake |
|---|---|---|
| **Affidabilità: impostazioni perse o blocco che smette di funzionare** | GH (34 commenti), GH (Android rotto da un'API non supportata, 15 reazioni), AMO: *"periodically loses all preferences"*, *"stops working every few weeks"* | Snapshot automatici, migrazioni di schema, verifica di integrità, rilevamento delle funzionalità con degrado controllato, test automatici anche su Android. |
| **Prestazioni** | GH; AMO 2026: *"uses a TON of resources… CPU over 100%"*, *"10% CPU on idle"* | Architettura a eventi; nessun polling al secondo su tutte le tab. |
| **Conteggio del tempo inaccurato** | Conteggio durante la sospensione; app minimizzata su Android; più finestre aperte; timer azzerati dopo il riavvio; cambio di fuso orario; pagine di errore; modalità lettura | Motore di misurazione con idle detection, gestione dei salti di orologio, unicità del conteggio per gruppo e persistenza robusta. |
| **Semantica difficile da capire** | FAQ "Why is nothing being blocked?" (protocollo nell'URL, nessun giorno selezionato, `AND` senza entrambe le condizioni); fasce notturne non supportate (FAQ, GH); AMO: *"time block is not optional"*, *"UX is confusing"*, *"couldn't find how to block indefinitely"*; molte Q&A del tipo "perché non viene bloccato?" | Modello a policy esplicite, riepilogo in linguaggio naturale, validazione in tempo reale, strumento "Prova un URL". |
| **Interazioni tra gruppi** | Tempo di sblocco errato con più gruppi, gruppi che si annullano, un'eccezione in un gruppo sopprime i timer degli altri, aggiramento riordinando i gruppi | Regola deterministica "vince l'intervento più restrittivo"; le eccezioni valgono solo nel proprio gruppo. |
| **Perdita di stato e lavoro** | Testo dei commenti perso al blocco; tab bloccate non ripristinate con la sessione; richiesta di ripristino in massa; posizione del video persa | Periodo di grazia per i form, URL originale preservato, ripristino in blocco, ripresa del video. |
| **Mobile** | Pagina opzioni poco adatta al mobile (HN 2023, GH), riquadro del codice fuori schermo, statistiche illeggibili, timer assente nelle web app installate, `about:addons` non bloccabile su Android | UI *mobile-first*; limiti di piattaforma documentati in modo trasparente. |
| **Vie di fuga** | Navigazione privata (recensioni AMO e Chrome Web Store), altri browser e profili (HN: *"too easy to get around"*), modalità provvisoria, modifica dell'orologio, devtools sulla pagina delle opzioni, codice casuale copiabile dal sorgente, incolla nel campo del codice, proxy e incorporamenti (GH: video YouTube tramite Bing), tasto Indietro | Centro protezione, procedura guidata per le policy, rendering del codice su canvas, blocco dei sub-frame, ricontrollo al ripristino dalla bfcache. Vedi [Appendice A](#appendice-a--vettori-di-elusione-e-contromisure). |
| **Blocchi irreversibili per errore** | Opzioni bloccate "per sempre"; l'unica soluzione è scrivere allo sviluppatore (FAQ *reset-password*, *options-disabled*) | Uscita d'emergenza integrata, ad alta frizione ma sempre disponibile. |
| **Sicurezza** | ReDoS da regex importate, jQuery vulnerabile (1.3.1), permesso `history` obbligatorio poi reso facoltativo | Validazione delle regex, dipendenze minime, permessi facoltativi richiesti al momento del bisogno. |

#### 3.2.2 Richieste più votate non (completamente) implementate

Le richieste sono raggruppate per tema. Tra parentesi: voti o reazioni della discussione principale.

1. **Override più intelligenti**
   - Limite espresso in *tempo* invece che in numero (6).
   - Override per singolo URL, pagina o gruppo.
   - Durata "fino a X minuti".
   - Durata e numero di override per gruppo.
   - Override mensili.
   - Override consumato come un budget e non a orologio.
   - Il lockdown disattiva gli override.
   - Costo crescente.
2. **Motivo dell'override e registro** del tempo usato (6).
3. **Limiti per numero di visite o accessi** e **cooldown** dopo un uso continuativo.
4. **Blocco di contenuti incorporati e risorse** (iframe, video, immagini; 8) e **pagina caricata senza immagini e video** (6).
5. **Rollover cumulativo** con reset configurabile.
6. **Note libere per gruppo**, per ricordare il perché.
7. **Limitare apertura e durata della pagina delle opzioni** e **ritardo per modificare le impostazioni**.
8. **Sfide alternative al codice casuale** (matematica, puzzle), lunghezza e caratteri configurabili, divieto di incollare.
9. **Password o protezione separata per gruppo**.
10. **Sblocco in date specifiche** e ricorrenze mensili.
11. **Statistiche più dettagliate**: giorno, settimana, mese, anno, storico.
12. **Ritardo più efficace**:
    - Countdown nascosto (ispirato a Dopanope).
    - Durata casuale.
    - Ritardo che si ripresenta dopo X minuti.
    - Nessun ritardo navigando tra siti dello stesso gruppo.
    - Filtro temporaneo al posto della pagina di ritardo.
    - Pulsante invece del reindirizzamento automatico.
13. **Non perdere il lavoro**: ritardare il blocco mentre si scrive.
14. **Ripresa del video** dal punto in cui si era.
15. **Sessione focus in modalità allowlist**, **lockdown ritardato o programmato**, **notifica a fine lockdown**.
16. **Durata della sessione scelta dall'utente** all'ingresso.
17. **Tempo "dedicato" per sbloccare**, cioè guadagnare minuti facendo attività utili.
18. **Liste di categorie pubbliche** e **compatibilità della sintassi** con uBlock Origin, uBlacklist e AdGuard.
19. **Gestione di molti gruppi**, **sotto-gruppi e liste condivise**.
20. **Integrazioni e API** per attivare il lockdown da programmi esterni.
21. **Varie**:
    - Settimana che inizia di lunedì.
    - Lingua scelta indipendentemente da quella del browser.
    - Intensità dei filtri.
    - Silenziare la tab senza filtro.
    - Timer mostrato solo vicino alla scadenza.
    - Badge senza la soglia dei 10 minuti.
    - Cancellare dalla cronologia le visite ai siti bloccati.
    - Nascondere l'URL nella pagina di blocco.
    - Eccezioni alle parole chiave.
    - Blocco basato sulla posizione.
    - Sincronizzazione (GH, 14 reazioni).

> **Osservazione.** Tra le idee più votate dominano due temi: **override più granulari e più costosi** e **più precisione** (pagina, elemento, contenuto incorporato, numero di visite). Questo è coerente con la letteratura: servono frizione proporzionata e flessibilità contestuale ([§3.5](#35-evidenze-scientifiche)).

### 3.3 Estensioni e app concorrenti

#### 3.3.1 Panoramica

| Prodotto | Tipo / modello | Idee chiave | Criticità emerse (recensioni e fonti) |
|---|---|---|---|
| **StayFocusd** (Chrome/Edge; ora di Sensor Tower) | Estensione freemium | Tempo massimo giornaliero; giorni e ore attivi; *Nuclear Option* non annullabile (blocca tutto o tutto tranne una allowlist); *Require Challenge* (digitare un testo per modificare le impostazioni); blocco di contenuti in pagina (video, immagini, form); blocco di elementi YouTube | Proprietà di un'azienda di market intelligence: tema di fiducia. Non esiste per Firefox. Su HN: *"just a right click away from being disabled"*. |
| **BlockSite** (Chrome, Firefox, mobile) | Freemium con abbonamento | Categorie (adulti), parole chiave, reindirizzamento, Focus Mode, pianificazione, Insights, sync, password, "prevenzione disinstallazione" | **Raccoglie URL visitati, IP, sistema operativo e browser** (dichiarato su AMO); una recensione del 2026 riporta la password inviata in chiaro via email; falsi positivi della categoria adulti (sito LGBTQ+ bloccato); paywall dopo 3 giorni o pochi siti; Focus Mode fisso a 25 minuti; lista bianca cancellata da sola; blocco dopo il caricamento della pagina; consumo di CPU e disco (160 KB ogni 2 s). |
| **Block Site** (Ray, open source) | Gratuita | Wildcard e regex, modalità inversa (allowlist), reindirizzamento per host, pianificazione per host, password principale, chiusura automatica delle tab, *managed storage* | *"Distrugge le tab aperte"* (URL riscritti in modo permanente), UX confusa, smette di funzionare dopo gli aggiornamenti, apre pagine web dopo l'installazione, tetto di 500 regole. |
| **Cold Turkey Blocker** (desktop + estensione) | App desktop, Pro a pagamento una tantum | Liste e categorie; blocco di app; pianificazione con trascinamento; **lock** di vari tipi (timer, fascia oraria, testo casuale fino a 5.000 caratteri, **ritardo da 1 minuto a 40 giorni**, riavvio del PC, password); **pause**: Pomodoro, *allowance* su finestra mobile o periodo con ricarica personalizzata, **reward** (pause guadagnate lavorando), **sessioni** (numero di utilizzi); blocco dei contenuti incorporati e delle tab inattive; blocco delle impostazioni di data e ora; *autostart* dei blocchi; CLI; "Pause for a Cause" (donazione per una pausa); dati locali ed esportabili | Richiede l'app nativa (non è un'estensione autonoma); non disponibile su Android. |
| **Freedom** (multipiattaforma) | Abbonamento, account obbligatorio | Sessioni su più dispositivi, *Locked Mode*, blocklist preimpostate, eccezioni (allowlist), sessioni ricorrenti, cronologia e note di sessione | Account e app desktop obbligatori; l'estensione Firefox non rileva le sessioni (AMO). |
| **one sec** (iOS, Android, estensione) | Freemium; nessun account; dati locali | Pausa con respiro e domanda prima di aprire il sito; opzione esplicita per rinunciare | Si riattiva navigando nello stesso sito (AMO 2026); tono percepito come colpevolizzante dopo un aggiornamento (AMO 2024). |
| **Intention** (open source) | Estensione + app; LLM con chiave propria (BYOK) | Un "coach" LLM chiede il motivo e concede minuti per l'intero sito o **per la singola pagina**; **scetticismo crescente** a ogni pass e tetto giornaliero; registro dell'esito di ogni pass; *streak* con **uno sgarro a settimana tollerato**; contesto modificabile solo tramite il coach; **"Rimuovi comunque" sempre disponibile** | Dipende da un provider LLM esterno (privacy, costi). |
| **Impulse Blocker** (open source) | Gratuita | Lista semplice e pausa | Alla fine della pausa la pagina aperta **non viene ribloccata** (lamentela più frequente); nessun sottodominio o percorso. |
| **Unhook, DF YouTube, News Feed Eradicator, SocialFocus, BlockTube** | Gratuite | Rimozione di feed, raccomandazioni, Shorts, commenti e metriche; sostituzione del feed con una citazione (NFE); filtri per canale o parola chiave (BlockTube) | **Si rompono a ogni restyling dei siti**; estensioni abbandonate; DF YouTube rilevata come adblocker; Unhook non open source (*"can't be trusted"*); la versione mobile si rompe; SocialFocus ha una privacy policy incoerente. |
| **uBlacklist** (open source) | Gratuita | Nasconde i siti indesiderati dai risultati dei motori di ricerca; sintassi a match pattern e regex; abbonamenti a liste pubbliche; sync tramite cloud personale | Si rompe quando i motori di ricerca cambiano il markup; avvisi invasivi per i permessi facoltativi. |
| **Time Tracker — Web Habit Builder** (open source, MIT) | Gratuita, solo locale | Tracciamento accurato, limiti giornalieri, settimanali e per visita, "siti virtuali" (sotto-URL), categorie, Pomodoro, backup su WebDAV, Gist o Obsidian, import da altri tracker | — (valutazione 4,9) |
| **HabitLab** (Stanford, open source) | Progetto di ricerca | Oltre 30 interventi su siti e app, **rotazione** degli interventi, obiettivi per sito | Rotazione = più efficacia ma più abbandoni [P5]. |
| **Mindful** (Android, open source) | App offline | *Invincible Mode* (impostazioni bloccate durante le restrizioni), bedtime, sessioni focus, limiti per gruppo di app | — |
| **ScreenZen** (iOS, Android) | Gratuita | **Attesa che cresce a ogni apertura**, limite di aperture al giorno, impostazioni protette | — |
| **Dopanope** (Chrome) | Gratuita | Ritardo con **countdown invisibile** | Evidenze solo aneddotiche. |
| **Forest** (estensione + app) | Freemium | Albero virtuale che appassisce se si visita la blacklist | Problemi di login e sync, consumo di memoria; *"no way to fail"*. |

#### 3.3.2 Matrice funzionale sintetica

Legenda: ✅ presente · ◐ parziale o limitato · ✖ assente · 🎯 obiettivo di WebHandbrake (rilascio).

| Funzione | StayFocusd | BlockSite | Cold Turkey | Freedom | one sec | Intention | **WebHandbrake** |
|---|---|---|---|---|---|---|---|
| Blocco per percorso o pagina | ✅ | ◐ | ✅ | ◐ | ✖ | ✅ | 🎯 R1 |
| Regex / wildcard avanzati | ✖ | ✖ | ◐ | ✖ | ✖ | ✖ | 🎯 R1 |
| Fasce notturne (oltre la mezzanotte) | ? | ◐ | ✅ | ✅ | — | — | 🎯 R1 |
| Limite di tempo | ✅ | ◐ | ✅ | ✖ | ◐ | ◐ | 🎯 R1 |
| Limite di visite o sessioni | ✖ | ✖ | ✅ | ✖ | ◐ | ◐ | 🎯 R1 |
| Ritardo / frizione | ✖ | ✖ | ◐ | ✖ | ✅ | ◐ | 🎯 R1 (varianti) |
| Domanda d'intenzione | ✖ | ✖ | ✖ | ✖ | ◐ | ✅ (LLM) | 🎯 R1 (locale) |
| Filtri (scala di grigi, ecc.) | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | 🎯 R1 |
| Rimozione di elementi (feed) | ◐ (YouTube) | ✖ | ✖ | ✖ | ✖ | ◐ | 🎯 R2 |
| Override per pagina | ✖ | ✖ | ✖ | ✖ | ✖ | ✅ | 🎯 R1 |
| Override con budget e motivo | ✖ | ✖ | ✅ | ✖ | ✖ | ✅ | 🎯 R1 |
| Sessione con allowlist | ✅ | ✅ | ✅ | ✅ | ✖ | ✖ | 🎯 R1 |
| Ritardo / cooling-off per indebolire | ✖ | ✖ | ✅ | ✖ | ✖ | ◐ | 🎯 R1 |
| Rafforzare sempre consentito | ✖ | ✖ | ✅ (estendere) | ✖ | ✖ | ✖ | 🎯 R1 |
| Blocco dei contenuti incorporati | ✖ | ✖ | ✅ | ✖ | ✖ | ✖ | 🎯 R1 |
| "Salva per dopo" | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | 🎯 R1 |
| Statistiche locali | ✅ | ✅ (cloud) | ✅ | ✅ (cloud) | ✅ | ◐ | 🎯 R1 |
| Nessuna raccolta dati | ? | ✖ | ✅ | ✖ | ✅ | ◐ (LLM) | 🎯 R1 |
| Android | ✖ | ✅ (app) | ✖ | ✅ (app) | ✅ (app) | ✅ (app) | 🎯 R1 |
| Open source | ✖ | ✖ | ✖ | ✖ | ✖ | ✅ | 🎯 |

#### 3.3.3 Lezioni trasversali dalle recensioni negative

1. **"Non funziona" è la prima causa di abbandono.** Blocchi che si disattivano da soli, impostazioni perse, rotture dopo gli aggiornamenti. L'affidabilità è la funzione più importante.
2. **Il blocco deve avvenire prima del caricamento** e deve **riapplicarsi da solo** quando scade una pausa (Impulse Blocker, BlockSite).
3. **Non distruggere le tab** né il lavoro dell'utente (Block Site di Ray, BlockSite).
4. **La privacy è un fattore di scelta**: gli utenti notano e puniscono raccolta dati, permessi eccessivi e codice chiuso (BlockSite, StayFree, Unhook, SocialFocus, Impulse Blocker).
5. **Le funzioni dipendenti dal markup dei siti si rompono** (Unhook, NFE, SocialFocus, uBlacklist). Servono regole aggiornabili come dati, non come codice, e una manutenzione comunitaria.
6. **UX confusa = abbandono** (Block Site e altri). Template, valori predefiniti sensati, linguaggio naturale.
7. **Paywall, account obbligatori e popup di upsell** generano recensioni da una stella (BlockSite, Freedom).
8. **Il tono conta**: pagine che sembrano un sito hackerato (*"Restricted Access"*) o che colpevolizzano (one sec 2024) vengono rifiutate.

### 3.4 Idee da domini adiacenti

| Dominio / prodotto | Meccanismo | Adattamento in WebHandbrake |
|---|---|---|
| **Gioco d'azzardo responsabile** (UK Gambling Commission, RTS 12) [X1] | Le **riduzioni** dei limiti si applicano subito; gli **aumenti** solo dopo un cooling-off di almeno 24 ore **e dopo una conferma esplicita** al termine dell'attesa. *Reality check* periodici, *time-out*, autoesclusione. | Principio di **asimmetria** (PRO-02, PRO-03); promemoria del tempo continuativo (NOT-05). |
| **Password manager** (Bitwarden Emergency Access) [X2] | Accesso concesso dopo un'attesa configurabile, durante la quale il titolare può rifiutare. | Sblocco d'emergenza con attesa lunga e annullabile (PRO-15). |
| **Benessere digitale dei sistemi operativi** (iOS Screen Time, Android Digital Wellbeing) | "Ancora un minuto", "Ignora il limite per 15 minuti", *Downtime*, "Sempre consentiti", Focus mode con "Fai una pausa", Bedtime in scala di grigi. | Pausa breve standard, allowlist globale protetta, fasce di "riposo" con filtro (INT-05). |
| **Ad blocker** (uBlock Origin, AdGuard) [X3] | Liste di filtri in abbonamento; *element picker*; *logger* che spiega quale regola ha agito; disciplina sulle prestazioni. | Abbonamenti a liste (LST-02), selettore di elementi (ELM-03), "Perché è bloccato?" (MAT-16, DIA-01), obiettivi di performance (PERF-*). |
| **Filtri dei risultati di ricerca** (uBlacklist) | Nasconde i siti indesiderati dalle SERP. | SRC-01. |
| **Feed eradicator** (News Feed Eradicator, Unhook) | Sostituisce il feed con contenuti scelti dall'utente. | ELM-04: feed sostituito da obiettivi, citazioni o lista "Più tardi". |
| **Read-later** (ex Pocket, Instapaper) | Salvare per leggere in un momento migliore. | **"Salva per dopo"** dalla pagina di blocco (INT-12): riduce la FOMO [P10] e non perde il link. |
| **Gestori di email** (Inbox When Ready, snooze) | Mostrare la posta solo in finestre scelte (*batching*). | Finestre d'uso consentite ("news solo 12:30–12:50") come policy inversa (SCH-03). |
| **Gestori di tab** (OneTab, Tab Wrangler, tab limiter) | Chiusura delle tab inattive, limite al numero di tab. | Possibile estensione futura (C-F): limite di tab aperte per gruppo. |
| **Time tracker** (ActivityWatch, RescueTime, Time Tracker) | Tracciamento locale, categorie produttive/distraenti, "siti virtuali". | STA-08; framing sul tempo distratto [P30]. |
| **Pomodoro** (Marinara, Tomato Clock) | Cicli lavoro/pausa configurabili, cronologia. | FOC-06 (BlockSite fissa 25 minuti: serve configurabilità). |
| **App di apprendimento** (Duolingo, Anki) | *Streak freeze*; esercizi brevi. | Streak indulgenti (MOT-03); micro-attività durante il ritardo (INT-10, GH). |
| **Token fisici** (Brick, talysman, HN 2026) | Lo sblocco richiede un oggetto fisico lontano. | Sblocco con chiave di sicurezza WebAuthn conservata altrove (PRO-07, da verificare). |
| **Controllo parentale e accountability** (Covenant Eyes, BlockerX) | Un partner approva le richieste di tempo extra. | **Partner offline via TOTP**: il partner ha il segreto sul proprio authenticator e detta il codice. Nessun server (PRO-06). |
| **Calendario** (Focus Time di Google Calendar, Clockwise) | Blocchi di concentrazione pianificati in calendario. | Import di un file ICS locale per attivare i gruppi (SCH-09, futuro). |
| **Coach conversazionali** (Intention, UpTime [P13]) | Dialogo che chiede il motivo e propone alternative. | Domanda d'intenzione locale senza LLM (INT-03); LLM opzionale come ricerca futura (INT-17). |

### 3.5 Evidenze scientifiche

#### 3.5.1 Sintesi degli studi

| # | Studio | Risultato principale | Implicazione di design |
|---|---|---|---|
| P1 | Lyngs et al., CHI 2019: review di **367** app ed estensioni con un modello *dual systems* | Prevalenza: blocco/rimozione > self-tracking > avanzamento verso obiettivi > ricompense/punizioni. Il 65% degli strumenti usa una sola strategia. Sono **poco esplorati**: la costruzione di abitudini, il **ritardo** (solo il 4% degli strumenti escluso il timer) e l'auto-efficacia. Il reindirizzamento automatizza le *implementation intentions*. | Combinare più strategie; investire nel **ritardo** e nelle abitudini alternative (reindirizzamento, alternative suggerite); rafforzare l'auto-efficacia (mostrare gli impulsi superati). |
| P2 | Monge Roffarello & De Russis, TOCHI 2023: review sistematica e meta-analisi | Effetto complessivo degli strumenti di autocontrollo digitale sulla riduzione dell'uso: **g = 0,47 (IC 95% 0,27–0,68)**, effetto medio-piccolo, su studi brevi. Gli strumenti basati solo su statistiche e blocchi richiedono motivazione continua. Chiede adattamento al contesto, valutazioni di lungo periodo ed etica. | Andare oltre il "tempo schermo": riflessione, contesto, flessibilità; non promettere miracoli; trattare i dati come sensibili. |
| P3 | Grüning et al., PNAS 2023 (one sec; N = 280 per 6 settimane, N = 500 in esperimento controllato) | Nel **36%** dei tentativi l'utente rinuncia; i tentativi calano del 37% in 6 settimane; il 57% delle aperture viene evitato. **La componente più efficace è l'opzione esplicita di rinunciare**; il ritardo aiuta; il solo messaggio di riflessione non basta. Meno uso percepito come problematico, più soddisfazione (d = 0,81). | La pagina d'intervento deve offrire **come azione primaria e più visibile "Chiudi / Non ora"**; il ritardo è un complemento. |
| P4 | Haliburton et al., CHI 2024 (1.039 utenti di one sec per 13,4 settimane in media) | Le frizioni brevi riducono in modo duraturo i tentativi e aumentano le aperture intenzionali; gli utenti fanno pause dallo strumento e, quando lo riprendono, l'effetto torna rapidamente. | Frizione leggera e sostenibile nel lungo periodo; consentire pause dallo strumento senza perdere la configurazione. |
| P5 | Kovacs, Wu, Bernstein, CSCW 2018 (HabitLab) | Con interventi statici il tempo sui siti torna a salire (assuefazione). La **rotazione** riduce il tempo (146 s → 96 s al giorno per sito) ma **aumenta gli abbandoni** (dopo una settimana resta il 52% contro il 74%). Un'informazione *just-in-time* sulla rotazione dimezza gli abbandoni. | Rotazione e varietà opzionali, spiegate al momento giusto. |
| P6 | Kovacs et al., CHI 2019 (*Conservation of Procrastination*) | Intervenire su un sito non sposta il tempo su altri siti né dal browser al telefono: l'effetto di "conservazione della procrastinazione" è minimo. | È legittimo concentrarsi sui siti scelti dall'utente. |
| P7 | Kovacs, Wu, Bernstein, CHI 2021 (*Not Now, Ask Later*; oltre 8.000 utenti) | Gli utenti partono con interventi difficili e **scivolano verso quelli facili**, pur credendo di tornare presto a quelli difficili. | **Rendere costoso e differito l'indebolimento** delle regole; rendere immediato il rafforzamento. |
| P8 | Kim et al., IMWUT 2019 (GoalKeeper) | I meccanismi restrittivi (lockout) sono **più efficaci** degli avvisi, ma causano **frustrazione e pressione** per via della varietà dei contesti d'uso. | Livelli di restrizione scelti dall'utente; eccezioni contestuali con costo; scala di frizione. |
| P9 | Mark, Czerwinski, Iqbal, CHI 2018 (blocco per una settimana al lavoro) | Concentrazione e produttività percepite aumentano, soprattutto per chi ha **meno autocontrollo**. Chi ha già molto controllo subisce più carico di lavoro e **meno pause**, quindi più stress. | Personalizzare il livello di rigore; suggerire pause fisiche durante le sessioni lunghe. |
| P10 | Lyngs et al., CHI 2020 (Facebook; N = 58) | Sia i promemoria degli obiettivi sia la rimozione del newsfeed aiutano a restare concentrati; i promemoria **infastidiscono**, la rimozione del feed genera **FOMO**. Gli utenti chiedono controlli sulla quantità di informazione e un blocco flessibile. | Rimozione degli elementi con "feed su richiesta"; promemoria sobri; "Salva per dopo". |
| P11 | Lukoff et al., CHI 2021 (YouTube) | Autoplay e raccomandazioni riducono il senso di *agency*; ricerca e playlist lo aumentano. | Rimozione di raccomandazioni e autoplay (ELM-01). |
| P12 | Zhang, Lukoff et al., CHI 2022 (Chirp) | Il 43% dichiarava inizialmente di usare il social "senza prestare attenzione". Liste personalizzate ed etichette di "già letto" riducono il consumo inconsapevole. | Riprogettare l'esperienza, non solo misurarla. |
| P13 | Tseng et al., CHI 2019 (UpTime) | Un sistema conversazionale aiuta la transizione dalla pausa al lavoro con limiti e dialoghi proattivi (effetto piccolo nella meta-analisi). | La domanda d'intenzione è utile ma non è una soluzione da sola. |
| P14 | Okeke et al., MobileHCI 2018 | Una vibrazione ripetuta dopo il limite riduce l'uso di oltre il 20% (g ≈ 0,83 nella meta-analisi P2), ma **l'effetto non persiste** dopo la rimozione. | I nudge funzionano finché sono attivi: lo strumento deve essere sostenibile da tenere installato. |
| P15 | Whittaker et al., CHI 2016 (MeTime) | Mostrare il tempo speso migliora la concentrazione (g ≈ 0,59 nella meta-analisi P2). | Timer e badge con informazioni sul tempo. |
| P16 | Xu et al., CHI 2022 (TypeOut; 10 settimane, N = 54) | Digitare una frase di **auto-affermazione** per sbloccare riduce l'uso di oltre il 50% e aperture e durata di oltre il 25%, meglio del solo testo casuale o della sola notifica. | Sfida "digita la tua frase d'impegno" (INT-04). |
| P17 | Dekker & Baumgartner, 2023 (scala di grigi, N = 84) | −20 minuti al giorno, più controllo percepito, meno stress; **il numero di sblocchi non cambia**. | Filtro in scala di grigi come intervento morbido (INT-05). |
| P18 | Holte et al. (scala di grigi) | Riduzione media di circa 39 minuti al giorno in campioni universitari. | Come sopra. |
| P19 | Allcott, Gentzkow, Song, AER 2022 | Permettere di fissare **limiti futuri** riduce sostanzialmente l'uso; secondo il modello, i problemi di autocontrollo spiegano il **31%** dell'uso dei social; le persone sottovalutano la formazione delle abitudini. | Il pre-commitment funziona ed è richiesto: pianificazioni e sessioni programmate. |
| P20 | Duckworth, Gendler, Gross, 2016 | Le strategie **situazionali** (scegliere o modificare la situazione) agiscono prima dell'impulso e sono più efficaci della forza di volontà. | Bloccare *prima* del caricamento; pianificare in anticipo. |
| P21 | Gollwitzer & Sheeran, 2006 (meta-analisi, 94 test) | Le *implementation intentions* ("se X, allora Y") hanno un effetto d = 0,65 sul raggiungimento degli obiettivi. | Reindirizzamento ad alternative e piani "se… allora…" (INT-06, MOT-02). |
| P22 | Ariely & Wertenbroch, 2002 | Le scadenze autoimposte (pre-commitment) migliorano le prestazioni. | Sessioni e lock autoimposti. |
| P23 | Rixen et al., MobileHCI 2023 | Le ragioni per interrompere lo scrolling sono soprattutto **contestuali** (fuori dall'app); esistono un loop interno alla sessione e uno abituale esterno. | Intervenire sia sulla sessione (durata, cooldown) sia sull'abitudine (frequenza, pianificazione). |
| P24 | *Design Frictions on Social Media*, 2024 | La frizione nello scroll migliora il ricordo dei contenuti ma è percepita come frustrante. | Frizione dosata e opzionale. |
| P25 | *Scrolling in the Deep*, 2025 (N = 72) | Il contesto (essere a casa, sonnolenza, umore) modula reattanza ed efficacia degli interventi; senza rilevanza contestuale ci si desensibilizza. | Interventi contestuali (fasce serali, stanchezza) e varietà. |
| P26 | Monge Roffarello & De Russis, CHI 2019 | Analisi delle app di benessere digitale e delle loro recensioni: strumenti poco personalizzabili e facili da aggirare. | Personalizzazione e protezioni. |
| P27 | Wohl, Pychyl, Bennett, 2010 | **Perdonarsi** per aver procrastinato riduce la procrastinazione successiva. | Tono non colpevolizzante; streak indulgenti; nessuna "vergogna". |
| P30 | Kim Y.-H. et al., CHI 2016 (TimeAware, citato in P1) | Mostrare il tempo speso in attività *distraenti* (framing negativo) sostiene meglio la produttività del tempo produttivo. | Statistiche centrate sul tempo distratto, con tono neutro. |

#### 3.5.2 Principi derivati dalla letteratura

1. **Prevenire è meglio che resistere** [P20, P19, P22]: pianificazioni, pre-commitment e blocco prima del caricamento.
2. **Frizione graduata invece del solo muro** [P1, P3, P4, P8, P16]: il ritardo e la domanda sono efficaci e meno frustranti di un lockout totale. Il lockout resta utile per chi lo sceglie.
3. **Rendere facile la scelta sana** [P3]: "Chiudi / Non ora" come azione primaria e più visibile.
4. **Asimmetria temporale** [P7, X1]: indebolire richiede tempo e una conferma successiva; rafforzare è istantaneo.
5. **Contro l'assuefazione** [P5, P14, P25]: varietà opzionale (rotazione, ritardo casuale), contesto, informazione *just-in-time*.
6. **Granularità e controllo dell'informazione** [P10, P11, P12]: rimuovere le parti che catturano (feed, autoplay) invece di togliere tutto il sito.
7. **Autonomia, etica e tono** [P2, P9, P27]: livelli scelti consapevolmente, nessuna vergogna, via d'uscita sempre esistente (anche se costosa), dati sensibili protetti.
8. **Auto-efficacia** [P1]: mostrare gli impulsi superati ("12 volte oggi hai scelto di non entrare").

> **Nota sulla trasferibilità.** Molti studi riguardano lo smartphone. Le estensioni hanno vantaggi propri (intercettazione prima del caricamento, granularità degli URL, modifica del DOM) e svantaggi propri (facile disattivazione, altri browser). I requisiti tengono conto di entrambi.

### 3.6 Vincoli tecnici della piattaforma

| Vincolo | Dettaglio | Conseguenza |
|---|---|---|
| **Manifest V3 su Chrome** | Background come *service worker*: terminato dopo **30 s di inattività**, 5 minuti massimo per evento; `chrome.alarms` con periodo minimo di **30 s** (Chrome 120+) [T3]. | Stato persistito sempre in storage; riconciliazione idempotente all'avvio; niente timer in memoria come fonte di verità. |
| **declarativeNetRequest** [T2] | Regole dinamiche: **30.000** "sicure" (block/allow/upgrade), di cui **5.000** "non sicure" (redirect, modifyHeaders); regole di sessione: 5.000; **1.000 regole regex**; le regole di sessione supportano `tabIds`; il redirect a una pagina dell'estensione richiede risorse *web accessible* e permessi sull'host. Le regole dinamiche **persistono tra i riavvii**. | Compilare i target in regole DNR (redirect del `main_frame`, blocco dei `sub_frame`); usare regole di sessione per i pass per singola tab; ripiegare sul blocco di rete se i permessi host vengono revocati; strategia di fallback oltre i limiti. |
| **Firefox (desktop e Android)** | Supporta MV3 (background come *event page* non persistente) e mantiene `webRequest` bloccante; DNR disponibile da Firefox 113. | Base di codice MV3 comune, con adattatori per piattaforma. |
| **Firefox per Android** [T1] | **Non supportati:** `commands` (scorciatoie), `menus` (menu contestuale), `windows` (incluso `onFocusChanged`), `history`, `sessions`, `tabs.discard`/`hide`, `sidebarAction`, `storage.managed`; `storage.sync` **non sincronizza**; `tabs.query` può restituire solo un sottoinsieme di tab. **Supportati:** DNR, `webRequest`, `webNavigation`, `tabs`, `alarms`, `idle`, `notifications`, `scripting`, `action` (con badge), `permissions.request` (dalla 120), `storage.session`. | Rilevamento delle funzionalità obbligatorio (vedi GH); misura del tempo attivo basata sulla `visibilitychange` della pagina; UI touch; nessuna funzione essenziale dipendente da API assenti. |
| **Permessi host** | Bloccare siti arbitrari richiede l'accesso a tutti i siti (avviso "leggere e modificare tutti i dati"). In Firefox MV3 e in Chrome l'utente può revocare l'accesso per singolo sito. | Verifica dei permessi all'avvio e quando cambiano (`permissions.onRemoved`); avviso; fallback a regole DNR di blocco, che non richiedono permessi host. |
| **Navigazione privata** | L'estensione è disattivata in incognito o nelle finestre private finché l'utente non la abilita; `extension.isAllowedIncognitoAccess()` permette di verificarlo. | Verifica in onboarding e nel centro protezione (PRO-09). |
| **Disinstallazione e disattivazione** | Un'estensione non può impedirle (policy degli store). Si possono solo bloccare le pagine di gestione mentre i blocchi sono attivi, oppure usare le **policy enterprise** del sistema operativo (installazione forzata, disattivazione di navigazione privata, ospite, devtools, modalità provvisoria). | Procedura guidata per le policy (PRO-10); trasparenza sui limiti. |
| **Pagine interne** | `about:*` e `chrome://*` non sono intercettabili via DNR; si possono rilevare con `tabs.onUpdated` e reindirizzare la tab, con limiti (per esempio su Android, GH). | Best effort documentato. |
| **Policy degli store** | Nessun codice remoto (MV3); AMO richiede sorgenti leggibili e build riproducibile; Chrome Web Store richiede uno scopo unico e una disclosure sulla privacy. | Le liste remote sono solo dati; pipeline di build riproducibile. |

---

## 4. Visione di prodotto e principi di design

### 4.1 Visione

> Aiutare chiunque a riallineare la propria navigazione con le proprie intenzioni, **con il minimo di frizione necessario e il massimo di rispetto**, senza cedere i propri dati a nessuno.

Il nome indica la filosofia: un **freno a mano** non è un muro. Si può tirare piano (un promemoria), di più (un'attesa, una domanda) o del tutto (un blocco con lucchetto). È l'utente a decidere quanto, in un momento di lucidità, e lo strumento rende difficile cambiare idea in un momento di impulso.

### 4.2 Principi guida

| # | Principio | Cosa significa in pratica |
|---|---|---|
| G1 | **Frizione graduata** | Una scala di interventi: traccia → ricorda → filtra → chiedi → attendi → sfida → blocca. Il default suggerito per i siti "tentazione" è la frizione, non il muro. |
| G2 | **Asimmetria** | Rafforzare le regole è sempre immediato, anche quando sono bloccate. Indebolirle è soggetto alla protezione scelta (attesa, conferma, sfida, partner). |
| G3 | **La scelta sana è la più facile** | In ogni intervento l'azione primaria è "Chiudi / Torna indietro / Salva per dopo"; proseguire è secondario. |
| G4 | **Precisione** | Pagine, percorsi, elementi, contenuti incorporati, numero di visite: colpire solo ciò che distrae (es. *Shorts* ma non i tutorial). |
| G5 | **Affidabile e spiegabile** | Il blocco funziona sempre, dall'avvio del browser; si può sempre chiedere "perché?" e ottenere una risposta esatta. |
| G6 | **Local-first e privato** | Nessun server, nessuna telemetria, nessun account; dati minimi, aggregati, esportabili e cancellabili. |
| G7 | **Rispetto e autonomia** | Tono gentile, mai colpevolizzante; i livelli severi sono scelti consapevolmente; esiste sempre un'uscita d'emergenza (costosa ma reale). |
| G8 | **Semplice di default, potente su richiesta** | Template e onboarding in 2 minuti; opzioni avanzate (regex, policy multiple) nascoste finché non servono. |
| G9 | **Sostenibile nel tempo** | Leggero sulle risorse; varietà opzionale contro l'assuefazione; niente notifiche moleste. |
| G10 | **Mobile come cittadino di prima classe** | Ogni funzione essenziale funziona su Firefox per Android; la UI nasce responsive. |

---

## 5. Stakeholder, personas e scenari

### 5.1 Stakeholder

| Stakeholder | Interesse |
|---|---|
| Utenti finali (autoregolazione) | Ridurre le distrazioni senza perdere l'accesso a ciò che serve. |
| Partner di accountability (facoltativo) | Custodire un codice o una password senza dover usare un servizio. |
| Utenti avanzati e amministratori del proprio PC | Configurazioni complesse, hardening tramite policy, import/export. |
| Contributori open source | Codice comprensibile, testabile, ben documentato; regole dei siti mantenibili. |
| Traduttori | Stringhe esternalizzate, plurali corretti, contesto. |
| Revisori degli store (AMO, Chrome Web Store) | Permessi giustificati, nessun codice remoto, privacy chiara. |

### 5.2 Personas

| Persona | Contesto | Bisogni | Frustrazioni attuali |
|---|---|---|---|
| **Giulia, 29 anni, sviluppatrice in remoto con ADHD** | Firefox desktop + Firefox Android; usa Reddit e YouTube *anche* per lavoro. | Frizione breve sui siti tentazione; accesso a singoli thread o video utili senza sbloccare tutto il sito; non perdere ciò che sta scrivendo. | Le pause degli strumenti che ha provato sbloccano l'intero gruppo di siti; disattiva l'estensione e poi "dimentica" di riattivarla. |
| **Marco, 21 anni, studente universitario** | Chrome, sessione d'esame. | Lockdown seri nei periodi di studio, fine settimana più liberi; non riuscire ad aggirarlo in incognito. | Bypass in incognito e da altri profili; blocchi che non si riattivano dopo la pausa. |
| **Sara, 46 anni, giornalista freelance** | Firefox desktop; deve informarsi ma soffre di doomscrolling. | Finestre brevi per le news; feed rimossi; promemoria del tempo continuativo; salvare articoli "per dopo". | Blocco totale = FOMO e perdita di link; i promemoria degli obiettivi la infastidiscono. |
| **Luca, 37 anni, power user che ha già provato altri blocker** | Linux, centinaia di tab, regole con regex. | Portare con sé le sue liste di siti; prestazioni con molte tab; strumenti di diagnosi; hardening via policy. | CPU alta con molte tab; regole che si sovrappongono in modo imprevedibile; nessun "perché?". |
| **Elena, 54 anni, utente poco tecnica** | Telefono Android con Firefox, tablet. | Ridurre YouTube la sera con poche scelte chiare; niente gergo. | Interfacce confuse, opzioni incomprensibili, campi orari `HHMM`. |
| **Paolo, 40 anni, partner di accountability** | Amico di Marco, nessun accesso al suo PC. | Custodire lo sblocco senza installare nulla di speciale. | Doversi fidare di servizi terzi. |

### 5.3 Scenari principali (user story)

| ID | Come… | voglio… | così che… |
|---|---|---|---|
| US-01 | nuova utente | configurare in 2 minuti un blocco per i social durante l'orario di lavoro partendo da un template | non debba studiare la documentazione. |
| US-02 | Giulia | che YouTube mi chieda "cosa vuoi fare?" e mi conceda 10 minuti solo per quel video | possa usare ciò che serve senza cadere nelle raccomandazioni. |
| US-03 | Giulia | che, se il blocco scatta mentre scrivo un commento, mi venga concesso un margine | non perda il testo. |
| US-04 | Marco | avviare un lockdown di 3 ore con allowlist (sito dell'università, documentazione) non interrompibile | resista alle tentazioni durante lo studio. |
| US-05 | Marco | essere avvisato se l'estensione non è attiva in incognito | chiuda quella via di fuga. |
| US-06 | Sara | consentire le news solo 12:30–12:50 e 19:00–19:30 | concentri il consumo in finestre scelte. |
| US-07 | Sara | salvare per dopo un articolo bloccato e ritrovarlo quando la finestra si apre | non perda informazioni importanti. |
| US-08 | Luca | importare le mie liste di siti (anche in formato hosts o uBlock) | non debba ricostruirle a mano. |
| US-09 | Luca | sapere esattamente quale regola sta agendo su un URL e quando cambierà | possa correggere le sovrapposizioni. |
| US-10 | utente | che rimuovere un sito dal blocco richieda 24 ore e una conferma successiva, mentre aggiungerlo sia immediato | i miei momenti di debolezza non disfino le decisioni lucide. |
| US-11 | Elena | limitare YouTube a 45 minuti la sera con una schermata chiara quando il tempo finisce | dorma meglio. |
| US-12 | Paolo | dare a Marco un codice a 6 cifre quando lo ritengo giusto, senza account né server | faccia da garante. |
| US-13 | utente | limitare un sito a 3 visite al giorno senza limite di durata per visita | controlli la posta 3 volte invece che 30. |
| US-14 | utente | vedere quante volte ho scelto di non entrare | senta di fare progressi. |
| US-15 | utente | nascondere i feed e le raccomandazioni di YouTube e Reddit senza bloccare i siti | possa usare ricerca e iscrizioni senza perdermi. |
| US-16 | utente pentito di una configurazione troppo severa | avere un'uscita d'emergenza documentata, anche se lenta | non debba reinstallare il browser né scrivere allo sviluppatore. |

---

## 6. Requisiti funzionali

### 6.1 Modello concettuale

```
Gruppo ─┬─ nome, colore, icona, nota "perché", stato (attivo/archiviato)
        ├─ Target[]  (blocco o eccezione; dominio, percorso, pattern, regex, parola chiave, referrer, lista condivisa)
        ├─ Policy[]  (ordinate)  ── Condizione  ─┬─ finestre settimanali / date
        │                                        ├─ budget (tempo, visite, sessione, cooldown)
        │                                        ├─ stato (sessione focus attiva, finestra privata, tab attiva…)
        │                                        └─ "sempre"
        │                         └─ Intervento (traccia | ricorda | filtra | chiedi | attendi | sfida | blocca | chiudi | reindirizza)
        ├─ Regole di rimozione elementi (R2)
        ├─ Politica delle pause (consentite?, ambito, durata, budget, costo, motivo)
        └─ Protezione (livello, override per gruppo)

Liste condivise ── riutilizzabili da più gruppi (es. "Social", "Mirror e proxy")
Sessione focus ── gruppi coinvolti o modalità allowlist, durata, inizio, sbloccabilità
Allowlist globale ("Sempre consentiti") ── protetta, prevale su tutto
Modifiche in sospeso ── richieste di indebolimento in cooling-off
Registro eventi locale ── tentativi, pause, motivi, manomissioni (ring buffer)
```

### 6.2 Semantica di valutazione (normativa)

| ID | Regola | Pri | Rel |
|---|---|---|---|
| SEM-01 | Gli interventi hanno una **gravità ordinata**: `consenti < traccia < ricorda < filtra < chiedi < attendi < sfida < blocca < chiudi`. Il reindirizzamento ha la stessa gravità del blocco. | M | R1 |
| SEM-02 | **Dentro un gruppo**: si scartano gli URL che corrispondono a un'eccezione *più specifica* del target che li include; poi si valutano le policy nell'ordine definito dall'utente e **vince la prima la cui condizione è vera** (come in un firewall). L'interfaccia mostra l'ordine e un riepilogo in linguaggio naturale. | M | R1 |
| SEM-03 | **Tra gruppi diversi**: si applica l'intervento **più grave** tra tutti i gruppi che corrispondono. L'ordine dei gruppi non influisce mai sulla severità (problema segnalato in GH). | M | R1 |
| SEM-04 | Un'eccezione vale **solo nel proprio gruppo** e non sospende conteggi o timer di altri gruppi. | M | R1 |
| SEM-05 | L'**allowlist globale** "Sempre consentiti" prevale su tutti i gruppi e sulle sessioni (strumenti di lavoro, sito della banca…). Aggiungere voci è un indebolimento soggetto a protezione. | S | R1 |
| SEM-06 | **Specificità** delle corrispondenze, confrontata in quest'ordine: (1) numero di etichette dell'host che corrispondono in modo letterale (`m.youtube.com` > `youtube.com` > `*.com`); (2) numero di segmenti di percorso letterali, esclusi i caratteri jolly (`/r/*/comments/*` = 2); (3) a parità, l'URL esatto prevale sul prefisso e il prefisso sul pattern. Le regex hanno specificità minima, salvo diversa indicazione dell'utente. **A parità di specificità vince il blocco.** Questo permette le "eccezioni delle eccezioni": con `reddit.com` bloccato, `+reddit.com/r/*/comments/*` consentito e `reddit.com/r/funny/*` bloccato, `reddit.com/r/rust/comments/1` è consentito, mentre `reddit.com/r/funny/comments/1` è bloccato (parità 2–2, vince il blocco). "Prova un URL" mostra quale voce ha prevalso. | M | R1 |
| SEM-07 | Il **tempo di sblocco** mostrato è calcolato sull'insieme di tutte le policy e di tutti i gruppi applicabili (problema segnalato in GH). | M | R1 |
| SEM-08 | Una **visita** inizia quando il tempo attivo su un gruppo riprende dopo almeno N minuti (default 5, configurabile) senza tempo attivo su quel gruppo. | M | R1 |
| SEM-09 | I **giorni** del calendario iniziano a un'ora configurabile (default 00:00; es. 04:00 per i nottambuli). Fasce e budget giornalieri usano questa definizione. | S | R1 |

### 6.3 Target e corrispondenza (MAT)

| ID | Requisito | Pri | Rel | Fonte |
|---|---|---|---|---|
| MAT-01 | Aggiungere target per **dominio**, inclusi i sottodomini per default, con l'opzione "solo questo host". | M | R1 | GH; AMO:impulse-blocker |
| MAT-02 | **Normalizzare l'input**: accettare URL completi incollati (rimuovere protocollo, `www`, slash finale), IDN/punycode, host senza distinzione di maiuscole; segnalare gli errori riga per riga. | M | R1 | Doc |
| MAT-03 | Target per **percorso o prefisso**, per **pagina esatta** e "**solo homepage**". | M | R1 | GH; Doc |
| MAT-04 | **Eccezioni** a qualunque granularità, con precedenza per specificità (SEM-06). | M | R1 | GH |
| MAT-05 | **Wildcard** (`*` in un segmento, `**` su più segmenti) e **import della sintassi** di uBlock Origin, AdGuard e uBlacklist (`\|\|example.com^`, `*://*.example.com/*`). | S | R1 | GH |
| MAT-06 | Target **regex** (modalità avanzata) con validazione, limite di complessità e protezione dal ReDoS; compilazione in regole DNR compatibili con RE2 quando possibile. | S | R1 | GH |
| MAT-07 | Corrispondenza su **parametri di query** (es. `youtube.com/watch?list=…`) e, facoltativamente, sul **frammento** (default: ignorato). | S | R1 | GH |
| MAT-08 | **Commenti** nelle liste (`#`) e nota libera per riga. | M | R1 | Doc |
| MAT-09 | **File locali** (`file://`) e pagine interne del browser come target. | S | R1 | Doc; GH |
| MAT-10 | **Condizione sull'origine della navigazione**: trattare diversamente l'URL digitato o il segnalibro rispetto al link seguito da un'altra pagina (es. "consenti Reddit se arrivo da un motore di ricerca"), usando il `transitionType` di `webNavigation` e, in subordine, il referrer. | S | R2 | GH, Doc |
| MAT-11 | **Parole chiave nell'URL o nella query di ricerca** dei principali motori di ricerca. | S | R2 | BlockSite, Cold Turkey, GH |
| MAT-12 | **Parole chiave nel titolo o nel contenuto** (permesso facoltativo, elaborazione solo locale): modalità blocca o consenti, wildcard o regex, **eccezioni alle parole chiave**, ambito (titolo, intestazioni, corpo), ricontrollo sui contenuti dinamici e sulle SPA. | C | R2 | Doc, GH |
| MAT-13 | Blocco dei **contenuti incorporati** dei siti target in altre pagine (iframe, embed video), opzionale per gruppo. | S | R1 | GH; Cold Turkey |
| MAT-14 | Copertura di **mirror, proxy e frontend alternativi** tramite liste curate (Google Translate proxy, archivi, cache, frontend alternativi di YouTube, X e Reddit, sottodomini mobili, domini brevi come `youtu.be`). | C | R2 | GH, Doc |
| MAT-15 | Helper per **canali e playlist YouTube** (consenti o blocca per canale, playlist, ricerca). | C | R2 | Cold Turkey; GH |
| MAT-16 | Strumento **"Prova un URL" / "Perché?"**: per un URL (o la tab corrente) mostra i gruppi e le policy che corrispondono, l'intervento attuale, il motivo, il budget residuo e il prossimo cambiamento previsto. | M | R1 | GH; logger di uBO |
| MAT-17 | **Aggiungere la pagina corrente** dal popup o dal menu contestuale, scegliendo la granularità (dominio, host, percorso, pagina) e il gruppo; la modifica è persistente. | M | R1 | GH; Doc |
| MAT-18 | **Liste condivise** riutilizzabili da più gruppi (es. la stessa lista "Social" con regole diverse in settimana e nel weekend). | S | R1 | GH; Doc |
| MAT-19 | Ambito per gruppo: **finestre normali, private o entrambe**. | S | R1 | GH; Doc |
| MAT-20 | Ambito per **container** di Firefox (es. solo nel container "Personale"). | C | R2 | Idea da Firefox Multi-Account Containers |
| MAT-21 | Target da **categorie** basate su liste pubbliche (social, giochi, news, shopping…) tramite abbonamenti (LST-02). | C | R3 | GH; Freedom, BlockSite |
| MAT-22 | Ordinamento, deduplicazione, incolla in blocco, conteggio delle voci; nessun limite artificiale al numero di gruppi o di voci. | S | R1 | GH; AMO:block-website (500 voci) |

### 6.4 Pianificazione e condizioni (SCH)

| ID | Requisito | Pri | Rel | Fonte |
|---|---|---|---|---|
| SCH-01 | Pianificazione settimanale con **più finestre per giorno, diverse per ogni giorno**, incluse le **finestre a cavallo della mezzanotte** (la finestra appartiene al giorno di inizio). | M | R1 | Doc, GH |
| SCH-02 | **Editor visuale** a griglia settimanale (trascinamento, anche touch) più inserimento testuale per gli utenti avanzati; preset ("orario d'ufficio", "sere", "tutto il giorno", "feriali"). | M | R1 | Cold Turkey; AMO:block-website (UX) |
| SCH-03 | Modalità di condizione: **attivo durante le finestre**, **attivo fuori dalle finestre** (cioè "consentito solo in queste finestre") e **sempre**. | M | R1 | GH |
| SCH-04 | **Policy multiple per gruppo** (finestre e budget combinati) al posto di `OR`/`AND`, con riepilogo in linguaggio naturale aggiornato in tempo reale. | M | R1 | Doc |
| SCH-05 | **Eccezioni di calendario**: date singole, intervalli (ferie, esami), ricorrenze mensili (es. "il 15 di ogni mese, 19–21"). | S | R2 | GH |
| SCH-06 | **Fuso orario e ora legale** gestiti correttamente; inizio della settimana configurabile; ora di inizio del giorno configurabile (SEM-09). | M | R1 | GH |
| SCH-07 | **Resilienza alla manomissione dell'orologio**: rilevare i salti dell'orologio di sistema confrontando orologio monotono e orologio di sistema; facoltativamente, confrontare con l'intestazione `Date` delle risposte HTTP già ricevute nella navigazione (nessuna richiesta aggiuntiva); in caso di salto all'indietro, comportamento conservativo e registrazione. | S | R1 | Doc; Cold Turkey |
| SCH-08 | **Sessioni e lockdown programmati** e ricorrenti (es. ogni giorno feriale alle 9). | S | R2 | GH; Cold Turkey *autostart*; Freedom |
| SCH-09 | **Condizioni di contesto**: file ICS di calendario importato localmente, rete o posizione. | C | F | GH; P25 |

### 6.5 Limiti e budget (LIM)

| ID | Requisito | Pri | Rel | Fonte |
|---|---|---|---|---|
| LIM-01 | **Budget di tempo** per periodo: ora, giorno, settimana, mese e periodi personalizzati (da 5 minuti a 90 giorni), con minuti decimali. | M | R1 | Doc |
| LIM-02 | Budget su **finestra mobile** (es. 30 minuti in qualsiasi intervallo di 4 ore), in alternativa ai periodi allineati con offset. | S | R1 | Cold Turkey; Doc |
| LIM-03 | Budget **condiviso dal gruppo** oppure **per singolo sito** all'interno del gruppo. | M | R1 | GH |
| LIM-04 | **Budget di visite**: N visite per periodo (visita definita in SEM-08), con o senza limite di durata per visita. | M | R1 | GH; Cold Turkey; ScreenZen |
| LIM-05 | **Durata massima di sessione + cooldown obbligatorio** (es. massimo 10 minuti continuativi, poi 60 minuti di stop). | S | R1 | GH |
| LIM-06 | **Durata scelta all'ingresso** ("quanto vuoi restare?", da 1 a N minuti), poi blocco automatico, eventualmente seguito da cooldown. | S | R1 | GH; Regain, Mindful Browsing |
| LIM-07 | **Rollover** del tempo non usato con tetto massimo, accumulo opzionale e data di azzeramento; scelta dell'ordine di consumo. | S | R2 | GH |
| LIM-08 | **Tempo guadagnato**: il tempo trascorso su siti "produttivi" o in sessioni focus genera minuti di budget su un gruppo (con tetto). | C | R2 | Cold Turkey *Reward*; GH |
| LIM-09 | **Escalation a budget esaurito**: esaurire il budget attiva un'altra policy (es. dopo 30 minuti al giorno, ritardo di 60 s invece del blocco), con transizioni configurabili. | M | R1 | HN (uso reale); P1 |
| LIM-10 | **Visibilità del budget residuo** nel popup, nel badge e nel timer sovrapposto (soglia configurabile). | M | R1 | GH |
| LIM-11 | **Rinunciare subito** al tempo residuo o terminare la sessione in corso (azione di rafforzamento, sempre istantanea). | S | R1 | Doc |
| LIM-12 | **Tempo minimo di blocco** dopo il raggiungimento del limite. | C | R2 | Doc |

### 6.6 Misurazione del tempo (TIM)

| ID | Requisito | Pri | Rel | Fonte |
|---|---|---|---|---|
| TIM-01 | Contare il tempo solo quando la tab è **attiva**, la finestra **ha il focus** e l'utente **non è inattivo** (default); opzioni: contare le tab inattive, contare le tab che riproducono **audio o video** (anche in Picture-in-Picture). | M | R1 | Doc, GH |
| TIM-02 | **Rilevamento dell'inattività**: sospendere il conteggio dopo N secondi senza input (default 120 s, configurabile; disattivabile per i siti di lettura), tranne durante la riproduzione di media; nessun conteggio con schermo bloccato o dispositivo sospeso; salti temporali ignorati. | M | R1 | GH; AMO:stayfree |
| TIM-03 | **Niente doppio conteggio**: ogni gruppo accumula al massimo 1 secondo per ogni secondo reale, a prescindere dal numero di finestre o tab. | M | R1 | GH |
| TIM-04 | **Android**: contare solo con l'app in primo piano e la pagina visibile (`visibilitychange`), dato che l'API `windows` manca. | M | R1 | GH |
| TIM-05 | **Persistenza robusta** dei contatori al riavvio, ai crash e alla terminazione del service worker o della event page: perdita massima di 15 s. | M | R1 | GH |
| TIM-06 | Escludere pagine di errore, tab non caricate o scaricate dalla memoria; gestire la modalità lettura e `view-source:`. | S | R1 | GH |
| TIM-07 | Il tempo su un'eccezione non viene contato nel budget del gruppo. | M | R1 | GH |
| TIM-08 | Opzione "conta solo mentre interagisco" (scroll, click, tasti). | C | R2 | GH |

### 6.7 Interventi (INT)

| ID | Requisito | Pri | Rel | Fonte |
|---|---|---|---|---|
| INT-01 | **Pagina di blocco** dal design calmo e non colpevolizzante. Mostra: cosa è bloccato (con opzione per nascondere l'URL), il gruppo, la **nota "perché"** dell'utente, fino a quando, il budget residuo e la parola chiave trovata (se c'è). Gerarchia delle azioni: **primaria "Chiudi tab" o "Torna indietro"**, secondaria "Salva per dopo", terziaria "Fai una pausa" (solo se consentita e con il suo costo). | M | R1 | P3; GH; AMO:block-website ("Restricted Access") |
| INT-02 | **Pagina di ritardo** (countdown di N secondi, poi accesso). Varianti configurabili: (a) prosecuzione automatica o tramite pulsante; (b) countdown annullato o messo in pausa se la pagina perde il focus; (c) **countdown nascosto**; (d) **durata casuale** in un intervallo; (e) **ritardo crescente** a ogni visita del periodo; (f) applicato solo alla prima pagina del sito o del gruppo per X minuti; (g) accesso limitato a N minuti dopo il ritardo, poi il ritardo si ripresenta. | M | R1 | Doc; GH; ScreenZen; Dopanope |
| INT-03 | **Domanda d'intenzione**: "Cosa vuoi fare?" (testo libero o suggerimenti rapidi) e durata scelta (es. 5, 10, 15 minuti, entro un massimo). L'accesso vale per il tempo scelto; l'intenzione viene registrata localmente e mostrata come promemoria discreto durante la visita. | M | R1 | P13, P21; Intention, With Intention |
| INT-04 | **Sfida per proseguire**: (a) testo casuale di lunghezza e set di caratteri configurabili; (b) **frase d'impegno o di auto-affermazione** scelta dall'utente; (c) piccolo calcolo. Incolla disabilitato, input accettato solo da eventi `isTrusted`, testo da copiare **disegnato su canvas** (non presente nel DOM), con alternativa accessibile documentata. | S | R1 | P16; GH |
| INT-05 | **Filtri al posto del blocco**: scala di grigi (con **intensità** regolabile), sfocatura, dissolvenza, inversione, seppia, filtro CSS personalizzato; **silenziamento della tab** con o senza filtro. Utilizzabili anche come fase morbida (es. scala di grigi dopo 20 minuti). | S | R1 | P17, P18; GH |
| INT-06 | **Chiudi tab** o **reindirizza** a un URL scelto (sito produttivo, lista delle cose da fare). | M | R1 | Doc; GH; P1, P21 (Timewarp) |
| INT-07 | **Pagina di blocco personalizzabile**: messaggio su più righe, CSS personalizzato (senza risorse remote), oppure URL esterno con parametri (`{url}`, `{group}`, `{until}`) ed esclusione automatica dal blocco. | S | R1 | Doc; GH, Doc |
| INT-08 | **Pausa di respiro**: breve animazione guidata di respirazione prima di proseguire. | S | R2 | one sec |
| INT-09 | **Alternative suggerite**: lista personale ("fai due passi", "apri Anki", "leggi il libro") mostrata negli interventi, con apertura in un clic dei link produttivi. | S | R1 | P1 (abitudini), P21; GH |
| INT-10 | **Micro-attività durante il ritardo**: lista delle cose da fare locale, link a Anki, una carta da un mazzo locale. | C | R2 | GH |
| INT-11 | **Rotazione degli interventi** (opt-in) tra varianti equivalenti, con spiegazione *just-in-time*. | S | R2 | P5 |
| INT-12 | **"Salva per dopo"**: aggiunge l'URL a una lista locale "Più tardi", accessibile dal popup e dalla dashboard; avviso facoltativo all'apertura della finestra consentita; riapertura in blocco. | S | R1 | P10 (FOMO); GH |
| INT-13 | **Periodo di grazia per il lavoro in corso**: se il blocco scatta su una pagina con input in corso o non salvato, mostrare un countdown non rinviabile di N secondi (default 45) per finire o copiare il testo, con pulsante "copia la bozza". | S | R1 | GH |
| INT-14 | **Pass per singola pagina**: accesso a un URL specifico per N minuti senza sbloccare il resto del sito; uscire dalla pagina riattiva l'intervento. | S | R1 | GH; Intention |
| INT-15 | **Ripresa dei media**: al blocco, memorizzare la posizione dei video HTML5 (YouTube e generici) e ripristinarla al ritorno. | S | R2 | GH |
| INT-16 | **Modalità solo testo**: caricare la pagina bloccando immagini e video del sito. | C | R2 | GH |
| INT-17 | **Coach con modello linguistico** opzionale (chiave dell'utente o modello sul dispositivo), con disclosure chiara sulla privacy. Solo ricerca. | C | F | Intention |

### 6.8 Applicazione dei blocchi e gestione delle tab (ENF)

| ID | Requisito | Pri | Rel | Fonte |
|---|---|---|---|---|
| ENF-01 | **Blocco prima della navigazione**: le richieste `main_frame` verso target bloccati sono intercettate prima di raggiungere la rete (redirect DNR alla pagina dell'estensione). Nessun flash della pagina, nessun cookie impostato. | M | R1 | AMO:block-website, AMO:blocksite ("loads the page before blocking", cookie, richiesta al router); P20 |
| ENF-02 | **Applicazione immediata al cambio di stato** (inizio di una finestra, budget esaurito, fine di una pausa): tutte le tab aperte che corrispondono vengono gestite entro 1 s. Per gruppo si può scegliere: tutte le tab, solo la tab attiva, solo le tab inattive. | M | R1 | AMO:impulse-blocker; GH |
| ENF-03 | **Navigazione SPA**: rilevare `pushState`, `replaceState` e cambi di hash (es. `youtube.com/shorts`) senza reagire alle semplici ancore sulla stessa pagina. | M | R1 | GH |
| ENF-04 | **Conservare l'URL originale e lo stato della tab**; pulsante "Riapri" quando il blocco termina; riapertura automatica facoltativa; **ripristino in blocco** di tutte le tab bloccate. | M | R1 | GH; AMO:block-website ("destroys tabs") |
| ENF-05 | Le tab bloccate **sopravvivono al ripristino della sessione** e alle tab fissate. | S | R1 | GH |
| ENF-06 | **Cronologia**: le pagine dell'estensione non sporcano la cronologia; opzioni per aggiungere l'URL bloccato alla cronologia oppure per **cancellare le visite ai siti bloccati** (riduce l'autocompletamento tentatore). Il permesso `history` viene chiesto solo se l'opzione è attiva (non disponibile su Android). | S | R2 | Doc; GH |
| ENF-07 | Il blocco non dipende da script della pagina e non può essere impedito da `beforeunload` o `onunload`. | M | R1 | GH |
| ENF-08 | **Blocco attivo dall'avvio del browser**, prima della prima navigazione (regole DNR persistenti). | M | R1 | GH |
| ENF-09 | **Nessun loop**: la pagina di blocco e gli URL personalizzati sono esclusi automaticamente; protezione dal doppio ritardo o reindirizzamento e dalle collisioni con altri blocker. | M | R1 | Doc, GH |
| ENF-10 | **Ricontrollo al ripristino dalla bfcache** e sul tasto Indietro. | M | R1 | GH |
| ENF-11 | **Uscita elegante dallo schermo intero** prima di applicare un blocco o un filtro. | S | R1 | GH |
| ENF-12 | **Fallback senza permessi host**: se l'utente revoca l'accesso ai siti, l'estensione ripiega su regole DNR di sola **rete bloccata** (che non richiedono permessi host, dove supportato) e avvisa. | S | R1 | [T2] |
| ENF-13 | **Web app installate e widget**: best effort, con limiti documentati. | C | R2 | GH |

### 6.9 Pause e override (BRK)

| ID | Requisito | Pri | Rel | Fonte |
|---|---|---|---|---|
| BRK-01 | **Politica delle pause per gruppo**: consentite sì o no; consentite anche durante il lockdown sì o no. | M | R1 | Doc; GH |
| BRK-02 | **Ambito della pausa**: questa pagina, questo sito, questo gruppo, tutti i gruppi che le consentono. | M | R1 | GH |
| BRK-03 | **Durata**: fissa, oppure scelta dall'utente **fino a un massimo**, oppure da un elenco predefinito (es. 5, 10, 20 minuti). | M | R1 | GH |
| BRK-04 | **Budget delle pause** per gruppo e globale: numero e/o **minuti totali** per ora, giorno, settimana, mese o periodo personalizzato. | M | R1 | GH |
| BRK-05 | **Costo della pausa** per gruppo: nessuno, conferma, ritardo, sfida (INT-04), password, codice del partner (PRO-06). | M | R1 | Doc |
| BRK-06 | **Motivo** della pausa (facoltativo o obbligatorio) registrato con data, ora e tempo effettivamente usato. | S | R1 | GH |
| BRK-07 | La pausa **scade da sola** con riapplicazione immediata a tutte le tab coinvolte; avviso prima della scadenza. | M | R1 | GH; AMO:impulse-blocker |
| BRK-08 | Modalità **"pausa a consumo"**: i minuti di pausa si consumano solo mentre si è effettivamente sul sito. | S | R1 | GH |
| BRK-09 | **Annullare la pausa** in anticipo (rafforzamento, istantaneo). | M | R1 | Doc |
| BRK-10 | Pausa **visibile**: countdown nel badge e nel timer sovrapposto. | S | R1 | GH |
| BRK-11 | **Costo crescente**: ogni pausa aggiuntiva nello stesso periodo costa di più (ritardo più lungo, testo più lungo). | S | R2 | Intention; HN; GH |
| BRK-12 | **"Ancora un minuto"**: una micro-pausa singola di 1 minuto per chiudere ciò che si sta facendo, una volta per periodo e per gruppo. | C | R2 | iOS Screen Time |

### 6.10 Sessioni focus, lockdown e Pomodoro (FOC)

| ID | Requisito | Pri | Rel | Fonte |
|---|---|---|---|---|
| FOC-01 | **Sessione rapida** dal popup in al massimo 2 tocchi: blocca i gruppi scelti per X minuti o fino a un'ora precisa. | M | R1 | Doc; Freedom |
| FOC-02 | **Modalità allowlist**: durante la sessione è consentito solo un elenco di siti. | M | R1 | GH; StayFocusd Nuclear; Freedom; Cold Turkey |
| FOC-03 | **Sessione non interrompibile** (opzionale), con consenso esplicito, anteprima delle conseguenze e uscita solo tramite la procedura d'emergenza (PRO-15). | M | R1 | StayFocusd; Freedom *Locked Mode*; Cold Turkey |
| FOC-04 | **Inizio ritardato** ("tra 10 minuti"). Le sessioni programmate e ricorrenti sono coperte da SCH-08 (R2). | S | R1 | GH |
| FOC-05 | **Estendere** una sessione in corso è sempre possibile e istantaneo; accorciarla è un indebolimento. | S | R1 | Cold Turkey |
| FOC-06 | **Cicli Pomodoro** con durate di lavoro e pausa configurabili, pause lunghe, avvio automatico, notifiche e suoni facoltativi; i gruppi sono bloccati nelle fasi di lavoro. | S | R2 | GH; AMO:blocksite (25 minuti fissi) |
| FOC-07 | **Notifica di fine sessione** e riepilogo (tempo, tentativi fermati). | S | R1 | GH |
| FOC-08 | **Note di sessione** (cosa ho fatto). | C | R2 | Freedom |
| FOC-09 | Il lockdown può **disattivare le pause** dei gruppi coinvolti (configurabile). | S | R1 | GH |
| FOC-10 | **Promemoria di pausa fisica** durante le sessioni lunghe (es. ogni 90 minuti). | C | R2 | P9 |

### 6.11 Protezione e anti-elusione (PRO)

| ID | Requisito | Pri | Rel | Fonte |
|---|---|---|---|---|
| PRO-01 | **Livelli di protezione predefiniti**, spiegati con le loro conseguenze, impostabili globalmente e per gruppo: **Morbido** (conferma), **Equilibrato** (ritardo o domanda per indebolire, pause limitate), **Rigido** (cooling-off e sfida, impostazioni bloccate durante le finestre attive), **Blindato** (nessun indebolimento fino alla scadenza; solo uscita d'emergenza). | M | R1 | P8, P9; Doc |
| PRO-02 | **Asimmetria**: le modifiche che rafforzano (aggiungere siti, estendere finestre, ridurre budget, avviare o estendere sessioni) sono **sempre istantanee**, anche a impostazioni bloccate; quelle che indeboliscono seguono la protezione. Il sistema classifica automaticamente ogni modifica. | M | R1 | P7; X1; GH |
| PRO-03 | **Cooling-off**: un indebolimento viene messo in coda per un tempo configurabile (da 1 ora a 7 giorni), resta visibile nell'elenco "Modifiche in sospeso", è annullabile e **richiede una conferma esplicita dopo l'attesa**; se non viene confermato entro una scadenza, decade. | M | R1 | X1 (RTS 12); P7; GH; HN (K9: una settimana) |
| PRO-04 | **Impostazioni bloccate** durante le finestre attive (per gruppo e globali), con stato "bloccato" visibile e motivazione. | M | R1 | Doc |
| PRO-05 | **Requisiti di accesso alle impostazioni**: password (con hash), codice casuale configurabile (INT-04), fasce orarie, combinazione di più requisiti; la verifica avviene nel background, non solo nella UI. | M | R1 | Doc; GH |
| PRO-06 | **Partner offline via TOTP**: un partner scansiona un QR con una qualsiasi app authenticator; per indebolire o fare una pausa serve il codice a 6 cifre del partner. Nessun server. Il segreto non viene mai più mostrato dopo la configurazione. | S | R2 | Doc (password delegabile); BlockerX, Covenant Eyes (in versione offline) |
| PRO-07 | **Sblocco con chiave di sicurezza** (WebAuthn/FIDO2) conservata altrove. Da verificare la fattibilità nelle pagine dell'estensione. | C | F | Brick, talysman (HN 2026) |
| PRO-08 | **Blocco delle pagine interne** che permettono di eludere i blocchi mentre una protezione è attiva: Firefox (`about:addons`, `about:debugging`, `about:config`, `about:support`, `about:profiles`), Chrome ed Edge (pagina estensioni, impostazioni, `chrome://flags`). Opzione per estendere le pause anche a queste pagine. Limiti documentati (Android, pagine aperte da riga di comando). | M | R1 | Doc; GH |
| PRO-09 | **Navigazione privata**: verificare `isAllowedIncognitoAccess()`; guida in onboarding e avviso permanente nel centro protezione se l'accesso manca. | M | R1 | Recensioni AMO e Chrome Web Store |
| PRO-10 | **Procedura guidata di hardening**: genera i file di policy per Windows (`.reg`), macOS (`.mobileconfig`) e Linux (`policies.json` o JSON di Chrome) per: installazione forzata o bloccata dell'estensione; configurazione precaricata via managed storage; disattivazione di navigazione privata, modalità ospite, nuovi profili, modalità provvisoria e devtools. Con avvertenze esplicite e istruzioni di rimozione. | S | R2 | Doc (registro); GH |
| PRO-11 | **Managed storage**: lettura della configurazione all'avvio; le regole gestite sono in sola lettura nella UI (Firefox desktop e Chrome; non disponibile su Firefox Android). | S | R2 | Doc; Block Site (Ray) |
| PRO-12 | **Import e reset protetti**: importare una configurazione o fare un reset che **indebolisce** le protezioni attive equivale a un indebolimento (soggetto a cooling-off). | M | R1 | Lacuna degli strumenti esistenti |
| PRO-13 | **Rilevamento e registro delle manomissioni**: salti dell'orologio, riavvii con stato perso, permessi host revocati, accesso privato rimosso, estensione rimasta disattivata (rilevato alla riattivazione). Visibile nel centro protezione e allo sblocco successivo. | S | R1 | Doc |
| PRO-14 | **Resistenza ai devtools**: lo stato bloccato è imposto dal background; modificare il DOM delle pagine di opzione non sblocca nulla. | M | R1 | GH; AMO:blocksite (password aggirata rimuovendo un nodo HTML) |
| PRO-15 | **Uscita d'emergenza** sempre disponibile, ad alta frizione: richiesta → attesa lunga (default 24 ore, configurabile tra 4 ore e 7 giorni) → frase da digitare → registro. È annullabile durante l'attesa e non richiede di contattare nessuno. | M | R1 | GH, Doc; X2 |
| PRO-16 | **Protezione per gruppo** (password o livello diverso per ciascun gruppo). | S | R1 | GH |
| PRO-17 | **Limiti di accesso alle impostazioni**: massimo N aperture al giorno, massimo X minuti per apertura. | C | R2 | GH |
| PRO-18 | **Centro protezione**: checklist dei vettori di elusione noti con stato e rimedio (finestre private, permessi host, profili, modalità provvisoria, orologio, policy). | M | R1 | [Appendice A](#appendice-a--vettori-di-elusione-e-contromisure) |
| PRO-19 | **Nessun dark pattern**: niente blocco ingannevole della disinstallazione né messaggi colpevolizzanti; l'URL di disinstallazione (`setUninstallURL`) è disattivato per default e, se attivo, punta a una pagina statica del progetto senza parametri di tracciamento. | M | R1 | ETH-01 |

### 6.12 Rimozione degli elementi che distraggono (ELM)

| ID | Requisito | Pri | Rel | Fonte |
|---|---|---|---|---|
| ELM-01 | **Rimozioni predefinite** per i siti principali: YouTube (feed della home, raccomandazioni, Shorts, commenti, autoplay, schermate finali), Reddit (feed), X (scheda "Per te"), Facebook e Instagram (feed, Reels), LinkedIn (feed). Ogni voce si attiva singolarmente. | S | R2 | P10, P11; Unhook, NFE, SocialFocus, StayFocusd |
| ELM-02 | Le regole di rimozione sono **dati dichiarativi** (sottoinsieme della sintassi cosmetica di uBO) aggiornabili tramite una lista facoltativa mantenuta dalla comunità, per reagire ai restyling dei siti **senza codice remoto**. | S | R2 | Recensioni AMO (rotture continue) |
| ELM-03 | **Selettore di elementi** per nascondere qualsiasi parte di una pagina, salvato in locale per sito. | S | R2 | uBlock Origin |
| ELM-04 | **Sostituire il feed** con contenuti dell'utente: obiettivo, citazione, cose da fare, lista "Più tardi". | C | R2 | News Feed Eradicator |
| ELM-05 | **Feed su richiesta**: mostrare il contenuto nascosto dopo un clic e un breve ritardo, oppure limitarlo ai primi N elementi o a un budget di scroll. | C | R2 | P10, P23, P24 |
| ELM-06 | **Nascondere le metriche** (like, visualizzazioni, karma). | C | R2 | HN (karma nascosto); demetricator |
| ELM-07 | **Shorts e Reels** riprodotti nel player normale o con scroll infinito disattivato. | S | R2 | GH; youtube-shorts-block |
| ELM-08 | Le rimozioni possono dipendere da finestre e gruppi (es. raccomandazioni nascoste solo in orario di lavoro). | S | R2 | — |

### 6.13 Motori di ricerca (SRC)

| ID | Requisito | Pri | Rel | Fonte |
|---|---|---|---|---|
| SRC-01 | **Nascondere o oscurare i risultati** dei siti bloccati nei motori di ricerca principali (Google, Bing, DuckDuckGo, Startpage, Ecosia, Brave Search), con l'indicazione "bloccato fino alle…". | C | R2 | uBlacklist |
| SRC-02 | **Bloccare le ricerche** che contengono parole chiave scelte. | C | R2 | Cold Turkey, BlockSite |

### 6.14 Statistiche e riflessione (STA)

| ID | Requisito | Pri | Rel | Fonte |
|---|---|---|---|---|
| STA-01 | **Tracciamento locale** di tempo e visite per i siti dei gruppi (per default) e, facoltativamente, di tutti i siti (opt-in esplicito); conservazione configurabile. | M | R1 | Doc; GH |
| STA-02 | **Dashboard Insights**: oggi, settimana, mese, anno; per gruppo e per sito; andamento e confronto con il periodo precedente; leggibile su mobile. | M | R1 | GH |
| STA-03 | **Metriche dei tentativi**: accessi fermati, ritardi completati o abbandonati (*impulsi superati*), pause con motivo, sessioni focus. | M | R1 | P1, P3 |
| STA-04 | **Framing sul tempo distratto** e linguaggio neutro e non giudicante. | S | R1 | P30, P27 |
| STA-05 | **Riepilogo settimanale** locale con domande di riflessione ("è il tempo che volevi?") e suggerimenti di aggiustamento in un clic (stringere o allentare, con le regole di protezione). | S | R2 | P2, P12 |
| STA-06 | **Export** in CSV e JSON; **cancellazione** di tutti i dati, di un intervallo o di un sito. | M | R1 | Cold Turkey |
| STA-07 | **Minimizzazione**: per default si memorizzano aggregati giornalieri per dominio o gruppo; URL completi solo se il target è un percorso; il dettaglio delle finestre private non viene memorizzato (il budget viene comunque consumato). | M | R1 | G6; P2 (dati sensibili) |
| STA-08 | **Categorie** (produttivo, neutro, distraente) e "siti virtuali" (sotto-URL). | C | R2 | Time Tracker, RescueTime |
| STA-09 | **Mappa di calore** per ora del giorno e giorno della settimana. | C | R2 | — |

### 6.15 Motivazione e obiettivi (MOT)

| ID | Requisito | Pri | Rel | Fonte |
|---|---|---|---|---|
| MOT-01 | **Nota "perché"** per gruppo, mostrata negli interventi e nell'editor, con frequenza sobria (P10: i promemoria possono infastidire). | S | R1 | GH; P10 |
| MOT-02 | **Piani "se… allora…"** guidati nell'onboarding ("quando sento l'impulso di aprire X, farò Y"), collegati alle alternative di INT-09. | C | R2 | P21 |
| MOT-03 | **Streak indulgenti** (opt-in): giorni in cui le regole sono state rispettate, con uno sgarro a settimana assorbito; mai punitivi. | C | R2 | Intention; Duolingo; P27 |
| MOT-04 | **Gamification** (albero o animale virtuale). | W | — | Forest: fuori perimetro v1 |

### 6.16 Notifiche e feedback in pagina (NOT)

| ID | Requisito | Pri | Rel | Fonte |
|---|---|---|---|---|
| NOT-01 | **Timer sovrapposto**: trascinabile; dimensione, posizione e opacità configurabili; mostrato solo sotto una soglia (default 5 minuti); attivabile per gruppo; nascondibile per la visita; non mostrato per i blocchi permanenti; accessibile ai lettori di schermo. | M | R1 | GH; AMO (timer fastidioso) |
| NOT-02 | **Badge** sull'icona con il tempo residuo (soglia configurabile, senza il limite fisso dei 10 minuti) e tooltip. | M | R1 | GH |
| NOT-03 | **Avviso prima del blocco** (N secondi o minuti prima) in pagina e/o come notifica di sistema. | M | R1 | Doc |
| NOT-04 | **Notifiche di sistema** facoltative (permesso richiesto al momento del bisogno): fine sessione o lockdown, modifica in sospeso pronta da confermare, riepilogo settimanale. | S | R1 | GH |
| NOT-05 | **Reality check** opt-in: promemoria periodico in pagina del tempo continuativo passato su un gruppo. | S | R2 | X1; P12 (Chirp); app Farhan |
| NOT-06 | Rispetto di `prefers-reduced-motion`; nessun suono per default; suono facoltativo a fine pausa. | S | R1 | A11Y |

### 6.17 Template e liste (LST)

| ID | Requisito | Pri | Rel | Fonte |
|---|---|---|---|---|
| LST-01 | **Template integrati** e modificabili: Social, Video, News, Shopping, Giochi, Scommesse, Forum, Adulti (base), con domini alternativi e mobili già inclusi. | M | R1 | Freedom, BlockSite, Cold Turkey |
| LST-02 | **Abbonamenti a liste esterne** (HTTPS, opt-in): intervallo di aggiornamento, data dell'ultimo aggiornamento, anteprima delle differenze; formati supportati: lista di domini, file hosts, uBlacklist, AdGuard; nessuna telemetria. | S | R2 | Doc; GH; uBlacklist |
| LST-03 | **Condividere un gruppo** come file o testo da incollare. | S | R1 | — |
| LST-04 | **Repository comunitario** di template e regole di rimozione su GitHub. | C | R2 | — |

### 6.18 Gestione dei dati (DAT)

| ID | Requisito | Pri | Rel | Fonte |
|---|---|---|---|---|
| DAT-01 | **Export e import** della configurazione completa in JSON con schema versionato; scelta se includere statistiche e segreti (solo hash). | M | R1 | Doc |
| DAT-02 | **Import di liste di siti**: domini, file hosts, sintassi uBlock Origin / AdGuard e uBlacklist, con report delle righe non riconosciute. | M | R1 | Percorso di migrazione; Time Tracker (import) |
| DAT-03 | **Backup locali automatici**: snapshot a rotazione prima di ogni modifica (ultimi 20) più uno al giorno per 30 giorni; verifica di integrità all'avvio; ripristino guidato in caso di corruzione. | M | R1 | GH; AMO (impostazioni perse) |
| DAT-04 | Nome del file di export con **data e ora**. | S | R1 | GH |
| DAT-05 | Export e import **funzionanti su Android** (download e selettore di file). | M | R1 | Doc; HN |
| DAT-06 | **Reset** di fabbrica soggetto alle regole di protezione (PRO-12). | M | R1 | Doc |
| DAT-07 | **Migrazioni di schema** automatiche con rollback in caso di errore; i campi sconosciuti non vengono mai eliminati. | M | R1 | REL |
| DAT-08 | **Backup verso destinazioni scelte dall'utente** (file system, WebDAV). | C | R3 | Time Tracker |
| DAT-09 | **Sincronizzazione** cifrata end-to-end tra dispositivi. Il modello dati deve prevederla fin dalla v1: ID stabili, versioni e timestamp per entità, tombstone per le cancellazioni. | W (v1) | R3 | GH; HN |

### 6.19 Automazione e integrazioni locali (API)

| ID | Requisito | Pri | Rel | Fonte |
|---|---|---|---|---|
| API-01 | **Scorciatoie da tastiera** (desktop): apri il popup, avvia una sessione, blocca il sito corrente, apri la dashboard. Abilitate solo se l'API `commands` esiste (su Android non esiste). | S | R1 | Doc; GH |
| API-02 | **Menu contestuale** (desktop): blocca questo sito, pagina o link; avvia una sessione. | S | R1 | Doc |
| API-03 | **Interfaccia di automazione locale**: messaggi da estensioni in allowlist (`onMessageExternal`) e link profondi a pagine dell'estensione con parametri. Senza autenticazione sono ammesse **solo azioni di rafforzamento** (es. avviare una sessione). | C | R2 | GH |
| API-04 | **Companion nativo** facoltativo (native messaging) per estendere i blocchi ad altri browser o app. | C | F | HN; Cold Turkey |

### 6.20 Onboarding e aiuto (ONB)

| ID | Requisito | Pri | Rel | Fonte |
|---|---|---|---|---|
| ONB-01 | **Procedura di primo avvio** (al massimo 2 minuti, saltabile): obiettivo → template → finestre o limite → stile d'intervento → livello di protezione → verifica permessi → riepilogo. | M | R1 | AMO (UX confusa) |
| ONB-02 | **Verifica e guida dei permessi**: accesso a tutti i siti, finestre private, notifiche; istruzioni specifiche per browser e piattaforma. | M | R1 | Doc (Quick Start) |
| ONB-03 | **Aiuto contestuale** ed esempi accanto a ogni campo; riepilogo in linguaggio naturale sempre visibile nell'editor. | M | R1 | Doc |
| ONB-04 | **Validazione** che impedisce le configurazioni "che non bloccano nulla" (nessun target, nessun giorno, nessuna condizione, policy irraggiungibili) con messaggi chiari. | M | R1 | Doc |
| ONB-05 | **Modalità semplice e avanzata**. | S | R1 | Doc |
| ONB-06 | **Documentazione offline** inclusa nell'estensione e opzione per consentire sempre il sito della documentazione. | S | R1 | Doc |
| ONB-07 | **Spiegazione just-in-time** prima di attivare funzioni severe (sessione non interrompibile, livello Blindato), con anteprima di cosa sarà impossibile fare. | M | R1 | P5 |

### 6.21 Diagnostica (DIA)

| ID | Requisito | Pri | Rel | Fonte |
|---|---|---|---|---|
| DIA-01 | **Pagina di diagnostica**: regole compilate (numero di regole DNR rispetto ai limiti), stato dei permessi, registro locale delle decisioni recenti (buffer circolare, disattivabile), contatori di prestazione. | M | R1 | Doc (modalità diagnostica) |
| DIA-02 | **"Copia report diagnostico"** con dati redatti (nessun URL, salvo scelta dell'utente) da allegare alle issue GitHub. | S | R1 | — |
| DIA-03 | **Autotest**: verifica che il blocco funzioni aprendo una pagina di prova coperta da una regola di test. | S | R1 | Doc |

### 6.22 Impostazioni generali (SET)

| ID | Requisito | Pri | Rel | Fonte |
|---|---|---|---|---|
| SET-01 | **Tema** chiaro, scuro o di sistema, alto contrasto, colore d'accento. | M | R1 | Doc |
| SET-02 | **Lingua** scelta indipendentemente da quella del browser. | M | R1 | GH |
| SET-03 | Formato orario 12/24 h, inizio della settimana, ora di inizio del giorno, formato della data. | M | R1 | Doc; GH |
| SET-04 | **Gestione dei gruppi**: numero illimitato, riordino per trascinamento, duplicazione, archiviazione o disattivazione, colore e icona, ricerca e filtro. | M | R1 | GH |
| SET-05 | Attivazione e disattivazione di menu contestuale, badge e timer. | S | R1 | Doc |

---

## 7. Requisiti non funzionali

### 7.1 Privacy (PRIV)

| ID | Requisito | Pri |
|---|---|---|
| PRIV-01 | **Zero telemetria e zero analytics.** Nessuna richiesta di rete per default. Le uniche richieste ammesse sono quelle avviate da funzioni attivate esplicitamente dall'utente (abbonamenti a liste, URL personalizzato della pagina di blocco), elencate in una pagina "Connessioni di rete". | M |
| PRIV-02 | Tutti i dati restano in `storage.local` o IndexedDB del profilo; in v1 non si usa `storage.sync`. | M |
| PRIV-03 | **Permessi minimi**; i permessi facoltativi (`history`, `notifications`, accesso ai contenuti per le parole chiave) vengono richiesti solo al momento dell'attivazione della funzione, con spiegazione. | M |
| PRIV-04 | Il contenuto delle pagine viene letto solo dalle funzioni che ne hanno bisogno (parole chiave, rimozione di elementi, overlay), viene elaborato in memoria e non viene mai salvato. | M |
| PRIV-05 | Informativa in linguaggio semplice (nell'estensione e negli store); pagina "Cosa conserviamo" con dimensioni e periodi di conservazione; **cancellazione totale in un clic**. | M |
| PRIV-06 | Nessun font, script, immagine o CDN di terze parti nelle pagine dell'estensione. | M |
| PRIV-07 | Nessun codice remoto; build riproducibili; release firmate con changelog. | M |

### 7.2 Sicurezza (SEC)

| ID | Requisito | Pri |
|---|---|---|
| SEC-01 | Password salvate solo come hash con sale, tramite WebCrypto (PBKDF2-SHA256 con almeno 600.000 iterazioni, in linea con le raccomandazioni OWASP) o Argon2id (WASM); confronto a tempo costante; nessun segreto in chiaro negli export per default. | M |
| SEC-02 | CSP rigorosa per tutte le pagine dell'estensione (niente `eval`, niente script inline, niente risorse remote, incluso `url()` nel CSS personalizzato). | M |
| SEC-03 | **Sicurezza delle regex**: validazione, limiti di lunghezza e complessità, rifiuto dei pattern a rischio di backtracking catastrofico; preferenza per la valutazione via DNR (RE2) o con un motore a tempo lineare. | M |
| SEC-04 | Validazione di schema e dimensione dei file importati; nessuna interpretazione di HTML importato. | M |
| SEC-05 | Messaggistica interna con verifica del mittente; messaggi esterni solo da un'allowlist e solo per azioni di rafforzamento. | M |
| SEC-06 | Dipendenze minime, lockfile, audit automatico (Dependabot o Renovate), SBOM nelle release, policy di disclosure delle vulnerabilità (`SECURITY.md`). | S |

### 7.3 Prestazioni (PERF)

| ID | Requisito | Pri |
|---|---|---|
| PERF-01 | **Architettura a eventi**: nessun polling periodico di tutte le tab. Il "tick" del timer esiste solo per la tab attiva tracciata e per gli overlay visibili. Obiettivo: CPU in background trascurabile a riposo; nessun rallentamento percepibile con oltre 500 tab aperte. | M |
| PERF-02 | Decisione di blocco prima della navigazione (DNR); applicazione ai cambi di stato entro 1 s. | M |
| PERF-03 | Content script iniettati solo dove servono (siti dei gruppi o funzioni attive), leggeri e caricati in modo pigro. Obiettivo di memoria per il background: < 30 MB tipici (da validare con misure). | S |
| PERF-04 | Scritture su storage raggruppate (tipicamente non più di 1 ogni 10 s per i contatori), per ridurre l'usura del disco (cfr. AMO:blocksite). | M |
| PERF-05 | **Scala**: almeno 10.000 target complessivi gestiti entro i limiti DNR (30.000 regole sicure, 5.000 redirect, 1.000 regex), con strategia di fallback (raggruppamento dei domini in regole comuni, valutazione in `webNavigation`) e avviso in diagnostica. | S |
| PERF-06 | Apertura del popup in meno di 150 ms e della dashboard in meno di 500 ms su hardware medio (obiettivi da validare). | S |

### 7.4 Affidabilità (REL)

| ID | Requisito | Pri |
|---|---|---|
| REL-01 | La fonte di verità è lo storage persistente. All'avvio e al risveglio del background la riconciliazione è idempotente: le regole DNR vengono ricalcolate dalla configurazione e confrontate con quelle installate. | M |
| REL-02 | **Rilevamento delle funzionalità** e degrado controllato: nessun crash se un'API manca. | M |
| REL-03 | **Test automatici**: unità (motore delle regole, contabilità del tempo con orologio simulato, classificatore rafforzamento/indebolimento), integrazione (Playwright o `web-ext` su Firefox e Chrome), smoke test su Firefox per Android a ogni release. | M |
| REL-04 | **Nessun fallimento silenzioso**: se l'applicazione dei blocchi è compromessa (permessi revocati, limiti DNR superati, errori), l'utente viene avvisato in modo visibile. | M |
| REL-05 | Gli aggiornamenti preservano sempre i dati (DAT-07); canale beta pubblico prima delle release stabili. | S |

### 7.5 Compatibilità (COMP)

| ID | Requisito | Pri |
|---|---|---|
| COMP-01 | **Target ufficiali**: Firefox desktop (release corrente ed ESR corrente), Firefox per Android (release corrente), Chrome stabile (versione minima 121, per i limiti DNR attuali), Edge stabile. **Best effort**: Brave, Vivaldi, Opera. **Non target**: Safari, Tor Browser, Chromium mobile. | M |
| COMP-02 | **Un'unica base di codice MV3** con adattatori per piattaforma (service worker su Chrome, event page su Firefox). | M |
| COMP-03 | Su **Android**: UI touch e responsive; nessuna dipendenza da `commands`, `menus`, `windows`, `history`, `sessions`, `storage.managed`. | M |
| COMP-04 | Convivenza con altri blocker e ad blocker (uBO, AdGuard) senza loop né conflitti di redirect. | S |

### 7.6 Accessibilità (A11Y)

| ID | Requisito | Pri |
|---|---|---|
| A11Y-01 | Conformità **WCAG 2.2 livello AA** per tutte le pagine e gli overlay. | M |
| A11Y-02 | Navigazione completa da tastiera, focus visibile, gestione corretta del focus sulle pagine d'intervento. | M |
| A11Y-03 | Etichette ARIA, annunci dei countdown con frequenza moderata (niente annuncio ogni secondo). | M |
| A11Y-04 | Contrasto adeguato; informazione mai affidata al solo colore (anche nei grafici); `prefers-reduced-motion` e `prefers-color-scheme` rispettati; dimensione dei target di almeno 24×24 px (consigliati 44×44 px su mobile). | M |
| A11Y-05 | Le sfide (INT-04) hanno un'alternativa accessibile documentata che non le annulla (es. frase d'impegno al posto del testo su canvas per gli utenti di screen reader). | S |

### 7.7 Internazionalizzazione (I18N)

| ID | Requisito | Pri |
|---|---|---|
| I18N-01 | Tutte le stringhe esternalizzate, con plurali ICU e contesto per i traduttori. | M |
| I18N-02 | Supporto RTL (lingue scritte da destra a sinistra, come ebraico e arabo). | S |
| I18N-03 | **Inglese come lingua principale** (lingua sorgente di UI, documentazione, repository e schede degli store); italiano come prima traduzione al lancio; altre lingue dalla comunità tramite piattaforma (Weblate o Crowdin). | M |
| I18N-04 | Formati di data e ora localizzati; parole chiave Unicode e lingue senza spazi gestite correttamente. | S |

### 7.8 Usabilità (USAB)

| ID | Requisito | Pri |
|---|---|---|
| USAB-01 | Un nuovo utente crea la prima regola funzionante in meno di 2 minuti senza documentazione (test di usabilità con almeno 5 persone per release maggiore). | M |
| USAB-02 | "Perché questo sito è (o non è) bloccato?" ha risposta in al massimo 2 interazioni. | M |
| USAB-03 | Punteggio SUS di almeno 80 nei test di usabilità. | S |
| USAB-04 | Nessun termine tecnico nella modalità semplice (niente `HHMM`, regex, DNR). | M |

### 7.9 Manutenibilità, distribuzione e governance (MAINT)

| ID | Requisito | Pri |
|---|---|---|
| MAINT-01 | TypeScript; **motore delle regole puro**, indipendente dal browser e testabile; adattatori di piattaforma separati; lint, formattazione e CI su ogni pull request. | M |
| MAINT-02 | Decisioni architetturali documentate (ADR) e documentazione per sviluppatori. | S |
| MAINT-03 | Pubblicazione su AMO (con compatibilità Android), Chrome Web Store ed Edge Add-ons; sorgenti e istruzioni di build riproducibile per la revisione AMO. | M |
| MAINT-04 | **Licenza** copyleft (raccomandata GPL-3.0-or-later, vedi [§12](#12-decisioni-aperte)); `CONTRIBUTING`, codice di condotta, template per issue e PR, etichette, gestione dei duplicati, Discussions per le idee, roadmap pubblica. | M |
| MAINT-05 | Le regole di siti specifici (ELM, mirror, template) vivono in file di dati separati, revisionabili dalla comunità senza toccare il codice. | S |

### 7.10 Etica (ETH)

| ID | Requisito | Pri |
|---|---|---|
| ETH-01 | Nessun dark pattern, nessuna colpevolizzazione, nessuna monetizzazione basata sui dati. | M |
| ETH-02 | Consenso informato per le modalità severe (anteprima delle conseguenze); uscita d'emergenza sempre esistente (PRO-15). | M |
| ETH-03 | L'utente può sempre disinstallare l'estensione; WebHandbrake non tenta di impedirlo con mezzi non trasparenti. Le protezioni forti passano da policy che l'utente installa consapevolmente. | M |
| ETH-04 | Il linguaggio delle statistiche è descrittivo, non morale ("hai passato 2 h" e non "hai sprecato 2 h"). | S |

---

## 8. Architettura dell'interfaccia utente proposta

### 8.1 Principi UX applicati

| Principio (fonte) | Applicazione in WebHandbrake |
|---|---|
| **Divulgazione progressiva** (Nielsen Norman Group) | Modalità semplice per default; avanzate in sezioni espandibili ("Opzioni avanzate"), mai su pagine separate e nascoste. |
| **Riconoscimento invece di memoria** (euristica 6 di Nielsen) | Template, preset, griglia oraria visuale, suggerimenti di domini mentre si digita, riepilogo in linguaggio naturale. |
| **Prevenzione degli errori** (euristica 5) | Validazione in tempo reale (ONB-04), anteprima di "cosa succederà adesso", "Prova un URL". |
| **Visibilità dello stato** (euristica 1) | Popup con lo stato del sito corrente, badge, banner "Protezione attiva", "Modifiche in sospeso". |
| **Controllo e libertà, ma asimmetrici** (euristica 3 + G2) | Annulla immediato per i rafforzamenti; indebolimenti con attesa e conferma chiaramente comunicate. |
| **Calm technology** | Pagine d'intervento sobrie, colori tenui, nessun allarme rosso; animazioni lente e disattivabili. |
| **Mobile-first e responsive** | Layout a colonna singola sotto i 600 px; navigazione in basso su mobile; target da 44 px. |
| **Accessibilità by default** | Componenti semantici, contrasto AA, testi alternativi, focus ring visibile. |

### 8.2 Superfici dell'interfaccia

| Superficie | Ruolo | Note di piattaforma |
|---|---|---|
| **Popup** (icona nella barra) | Stato del sito corrente e azioni rapide | Su Firefox Android si apre dal menu Estensioni come pannello o pagina: stesso layout, responsive. |
| **Dashboard** (pagina delle opzioni a tutta pagina) | Gestione completa | SPA con routing; su mobile navigazione in basso. |
| **Pagine d'intervento** | Blocco, ritardo, intenzione, sfida, emergenza | Pagine dell'estensione caricate al posto del sito. |
| **Overlay in pagina** | Timer, avvisi, periodo di grazia, filtri, reality check | Shadow DOM isolato dagli stili del sito. |
| **Onboarding** | Primo avvio | Pagina dedicata, saltabile e riapribile. |
| **Notifiche di sistema** | Eventi asincroni (facoltative) | Permesso richiesto al momento del bisogno. |
| **Menu contestuale e scorciatoie** | Azioni rapide (solo desktop) | Assenti su Android. |

### 8.3 Architettura dell'informazione

```
Dashboard
├── Oggi (home)
│   ├── Stato attuale (protezione, sessioni attive, prossimi cambiamenti)
│   ├── Budget residui per gruppo
│   ├── Avvia sessione focus
│   └── Riepilogo del giorno (tempo, impulsi superati, pause)
├── Gruppi
│   ├── Elenco (card con riepilogo in linguaggio naturale, stato, interruttore)
│   ├── Editor del gruppo
│   │   ├── 1. Cosa  (siti, liste condivise, eccezioni, "Prova un URL")
│   │   ├── 2. Quando (policy: finestre, budget, sessioni)
│   │   ├── 3. Come   (intervento per policy, pagina di blocco, pause)
│   │   ├── 4. Protezione (livello, override per gruppo)
│   │   └── Avanzate (regex, referrer, ambito tab/finestre private, elementi)
│   ├── Liste condivise
│   └── Sempre consentiti (allowlist globale)
├── Focus
│   ├── Sessione rapida / allowlist / non interrompibile
│   ├── Sessioni programmate
│   └── Pomodoro (R2)
├── Più tardi (lista "Salva per dopo")
├── Statistiche
│   ├── Panoramica (giorno, settimana, mese, anno)
│   ├── Per gruppo e per sito
│   ├── Tentativi e pause (con motivi)
│   └── Esporta / cancella
├── Protezione
│   ├── Livello globale e accesso alle impostazioni
│   ├── Modifiche in sospeso (cooling-off)
│   ├── Checklist anti-elusione
│   ├── Partner (TOTP) (R2)
│   ├── Hardening con policy (R2)
│   └── Uscita d'emergenza
├── Impostazioni
│   ├── Aspetto e lingua
│   ├── Timer, badge, notifiche
│   ├── Misurazione del tempo (inattività, audio, …)
│   ├── Dati (backup, import/export, import di liste, reset)
│   ├── Privacy (cosa conserviamo, connessioni di rete)
│   └── Diagnostica
└── Aiuto (guida offline, FAQ, informazioni, licenza)
```

**Navigazione.** Desktop (≥ 900 px): barra laterale sinistra fissa con 7 voci e un badge numerico su "Protezione" quando ci sono modifiche in sospeso. Mobile (< 600 px): barra in basso con **Oggi · Gruppi · Focus · Statistiche · Altro** (Altro contiene Più tardi, Protezione, Impostazioni, Aiuto). Tablet: barra laterale compatta con sole icone ed etichette al passaggio del mouse o al focus.

### 8.4 Wireframe

#### 8.4.1 Popup (desktop, circa 360 × 520 px)

```
┌──────────────────────────────────────────┐
│ WebHandbrake                      ⚙   ?  │
├──────────────────────────────────────────┤
│  youtube.com                             │
│  ● Video · limite 45 min al giorno       │
│  ████████████░░░░░░  18 min rimasti      │
│  Finiti i 45 min: attesa di 30 s per     │
│  entrare · [Perché?]                     │
├──────────────────────────────────────────┤
│ [ ▶ Avvia sessione focus      25 min ▾ ] │
│ [ + Blocca questo sito ▾ ] [ Più tardi ] │
│ [ Pausa… ]   2 pause rimaste oggi        │
├──────────────────────────────────────────┤
│ Oggi  1 h 12 min sui siti limitati       │
│       9 volte hai scelto di non entrare  │
│                       Apri la dashboard →│
└──────────────────────────────────────────┘
```
- "Blocca questo sito ▾" apre la scelta di granularità (dominio, host, percorso, pagina) e del gruppo (MAT-17).
- Se l'impostazione è protetta, "Pausa…" mostra subito il costo ("richiede 60 s di attesa").
- Su un sito non coinvolto: "Nessuna regola su questo sito" e le azioni rapide.

#### 8.4.2 Dashboard — Oggi (desktop)

```
┌────────────┬───────────────────────────────────────────────────────────┐
│ ◉ Oggi     │  Buongiorno · Protezione: Equilibrata 🔒                  │
│ ▢ Gruppi   │ ┌───────────────────────────┐ ┌──────────────────────────┐ │
│ ▢ Focus    │ │ Ora attivi                │ │ Avvia una sessione focus │ │
│ ▢ Più tardi│ │ • Social   bloccato ⟶17:00│ │ [25] [50] [90] [fino a…] │ │
│ ▢ Statist. │ │ • News     consentito     │ │ ○ Solo gruppi selezionati│ │
│ ▢ Protez. ②│ │            fino alle 12:50│ │ ○ Solo questi siti …     │ │
│ ▢ Impost.  │ │ • Video    18 min rimasti │ │ [   Avvia   ]            │ │
│ ▢ Aiuto    │ └───────────────────────────┘ └──────────────────────────┘ │
│            │ ┌────────────────────────────────────────────────────────┐ │
│            │ │ Prossimi cambiamenti                                   │ │
│            │ │ 17:00 Social si sblocca · Video: attesa tra 18 min     │ │
│            │ └────────────────────────────────────────────────────────┘ │
│            │ ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐ │
│            │ │ 1 h 12 min   │ │ 9 impulsi    │ │ 2 modifiche in       │ │
│            │ │ su siti      │ │ superati     │ │ sospeso · Rivedi →   │ │
│            │ │ limitati     │ │              │ │                      │ │
│            │ └──────────────┘ └──────────────┘ └──────────────────────┘ │
└────────────┴───────────────────────────────────────────────────────────┘
```

#### 8.4.3 Gruppi — elenco

```
  Gruppi                                        [ + Nuovo gruppo ] [Template]
  ┌──────────────────────────────────────────────────────────────────────┐
  │ ● Social  (12 siti)                                   [■ attivo] ⋮   │
  │   Bloccato lun–ven 9:00–17:00. Fuori orario: 3 visite al giorno.     │
  │   🔒 Rigida · prossimo cambiamento 17:00                             │
  ├──────────────────────────────────────────────────────────────────────┤
  │ ● Video  (youtube.com, twitch.tv)                     [■ attivo] ⋮   │
  │   Ogni giorno 45 min, poi attesa di 30 s prima di entrare.           │
  │   Shorts e raccomandazioni nascosti.                                 │
  └──────────────────────────────────────────────────────────────────────┘
```
Ogni card mostra il **riepilogo in linguaggio naturale** generato dal motore (stessa funzione usata dall'editor e dallo strumento "Perché?").

#### 8.4.4 Editor del gruppo (desktop: due colonne; mobile: sezioni a fisarmonica)

```
┌─ Video ─────────────────────────────────────────┬─ In breve ─────────────┐
│ ① Cosa   ② Quando   ③ Come   ④ Protezione   ⋯  │ Ogni giorno 45 min su  │
├─────────────────────────────────────────────────┤ youtube.com e          │
│ Siti                                            │ twitch.tv, poi attesa  │
│  youtube.com                 dominio        ✕   │ di 30 s. Da lun a ven  │
│  twitch.tv                   dominio        ✕   │ 9–17: blocco.          │
│  + Aggiungi sito o incolla una lista…           │                        │
│ Eccezioni                                       │ ℹ Inclusi i sottodomini│
│  youtube.com/feed/subscriptions  percorso   ✕   │ (m.youtube.com,        │
│ Liste condivise:  [Mirror video ▾]              │ music.youtube.com…).   │
│                                                 ├────────────────────────┤
│ ▸ Opzioni avanzate (regex, referrer, ambito)    │ Prova un URL           │
│                                                 │ [youtube.com/shorts/…] │
│                                                 │ → Bloccato (policy 1)  │
└─────────────────────────────────────────────────┴────────────────────────┘
```

**Sezione ② Quando: elenco ordinato di policy.**

```
  Policy (valutate in ordine; vale la prima che corrisponde)
  1 ▸ Lun–Ven 09:00–17:00          → Blocco                    ⋮ ↕
  2 ▸ Sempre, dopo 45 min/giorno   → Attesa di 30 s (nascosta) ⋮ ↕
  3 ▸ Altrimenti                   → Solo conteggio
  [ + Aggiungi policy ]
```

**Editor delle finestre:** griglia settimanale a 7 colonne × 24 ore; si trascina per creare, si toccano i bordi per ridimensionare; le finestre notturne appaiono come due blocchi collegati; un campo testuale `09:00–17:00` sincronizzato per l'inserimento preciso e accessibile.

#### 8.4.5 Pagina d'intervento — blocco

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│                        ( icona freno )                       │
│                                                              │
│              Questo spazio è protetto fino alle 17:00        │
│                                                              │
│      "Voglio finire la tesi entro marzo."  — la tua nota     │
│                                                              │
│      reddit.com · gruppo Social                [Perché?]     │
│                                                              │
│          [        Chiudi la tab        ]   ← primario        │
│          [ Salva per dopo ]  [ Apri: Anki ]                  │
│                                                              │
│          Fai una pausa (60 s di attesa, 1 rimasta)  ← link   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

#### 8.4.6 Pagina d'intervento — ritardo e intenzione

```
┌──────────────────────────────────────────────────────────────┐
│                youtube.com · gruppo Video                    │
│                                                              │
│            Cosa vuoi fare su YouTube adesso?                 │
│   [ Guardare un video preciso ] [ Musica ] [ Altro… ______ ] │
│                                                              │
│            Per quanto tempo?   ( 5 ) ( 10 ) ( 15 ) min       │
│                                                              │
│            ◌◌◌◌◌◌◌◌○○  attendi qualche istante…             │
│            (countdown numerico nascosto se configurato)      │
│                                                              │
│          [   Non ora, chiudi   ]   ← primario                │
│          [ Continua ] (attivo al termine dell'attesa)        │
└──────────────────────────────────────────────────────────────┘
```

#### 8.4.7 Dialogo di pausa

```
  Pausa per: ( questa pagina ) ( reddit.com ) ( gruppo Social ) ( tutti )
  Durata:    ( 5 ) ( 10 ) ( 15 ) min        massimo 15
  Motivo:    [ cercare una soluzione a un bug        ]
  Costo:     digita: "Scelgo con intenzione"  [__________________]
  Budget:    rimangono 2 pause / 25 min oggi
  [ Annulla ]                                  [ Avvia pausa ]
```

#### 8.4.8 Protezione — modifiche in sospeso

```
  Modifiche in sospeso
  ┌─────────────────────────────────────────────────────────────────┐
  │ Rimuovere "news.ycombinator.com" da Social                      │
  │ Richiesta ieri alle 22:14 · confermabile tra 7 h 12 min         │
  │ [ Annulla richiesta ]                                           │
  ├─────────────────────────────────────────────────────────────────┤
  │ Aumentare il limite di Video da 45 a 60 min                     │
  │ Pronta: confermala entro 48 h oppure decade                     │
  │ [ Annulla ]                      [ Conferma ora ]               │
  └─────────────────────────────────────────────────────────────────┘
```

#### 8.4.9 Centro protezione — checklist

```
  Quanto è solida la tua protezione?
  ✅ Accesso a tutti i siti concesso
  ⚠ Non attiva nelle finestre private        [Come attivarla]
  ✅ Pagine di gestione estensioni bloccate durante i blocchi
  ℹ Modalità provvisoria di Firefox disponibile  [Disattiva con policy]
  ℹ Altri browser: fuori dal controllo di un'estensione  [Suggerimenti]
  ✅ Nessuna manomissione dell'orologio rilevata negli ultimi 30 giorni
```

#### 8.4.10 Overlay in pagina

```
                                         ┌───────────────┐
  (angolo configurabile, trascinabile)   │ ⏱ 4:59  Video │  ← visibile solo
                                         └───────────────┘    sotto soglia
  Periodo di grazia (INT-13):
  ┌────────────────────────────────────────────────────────────┐
  │ Il tempo per questo sito è finito. Hai 45 s per finire ciò  │
  │ che stai scrivendo.     [ Copia la bozza ]   ███████░░ 32 s │
  └────────────────────────────────────────────────────────────┘
```

#### 8.4.11 Mobile (Firefox per Android)

```
┌──────────────────────────┐
│ Oggi            🔒  ⚙    │
│ ┌──────────────────────┐ │
│ │ Video   18 min rim.  │ │
│ │ ████████████░░░░░    │ │
│ └──────────────────────┘ │
│ ┌──────────────────────┐ │
│ │ ▶ Avvia focus 25 min │ │
│ └──────────────────────┘ │
│ Prossimo: 21:00 attesa 30│
│ 9 impulsi superati oggi  │
├──────────────────────────┤
│ Oggi Gruppi Focus Stat ⋯ │
└──────────────────────────┘
```

### 8.5 Linee guida per i testi (microcopy)

| Fare | Evitare |
|---|---|
| "Questo spazio è protetto fino alle 17:00." | "ACCESSO NEGATO", "Restricted Access" |
| "Hai scelto di proteggere questo tempo." | "Sei stato bloccato!" |
| "Hai passato 1 h 12 min sui siti limitati." | "Hai sprecato 1 h 12 min." |
| "9 volte hai scelto di non entrare." | Classifiche, confronti con altri, vergogna |
| "Questa modifica allenta le tue regole: sarà confermabile tra 24 h." | Messaggi vaghi o tecnici ("DNR rule update pending") |

Tono: seconda persona, frasi brevi, verbi attivi, nessun gergo nella modalità semplice. I messaggi d'errore dicono cosa è successo, perché e cosa fare.

### 8.6 Design system

- **Token**: colori semantici (`surface`, `text`, `accent`, `calm`, `warning`, `danger` usato solo per le azioni distruttive), spaziatura su scala da 4 px, raggi, tipografia di sistema (nessun web font remoto), temi chiaro, scuro e ad alto contrasto.
- **Componenti**: card di gruppo, chip di policy, editor a griglia oraria, campo dominio con autocompletamento e validazione, barra del budget, countdown accessibile, dialogo con costo, banner di stato (protetto, in sospeso, manomissione), lista "Più tardi", grafici con etichette testuali e pattern.
- **Stati obbligatori per ogni vista**: vuoto (con invito all'azione e template), caricamento, errore (con rimedio), **bloccato** (con il motivo e quando si sblocca) e **in sospeso**.
- **Tecnologia UI** (da decidere in ADR): framework leggero (Svelte, Preact o Lit) per contenere la dimensione del bundle e la memoria del popup; componenti condivisi tra popup, dashboard e pagine d'intervento.

---

## 9. Roadmap e perimetro dei rilasci

### 9.1 R1 — v1.0 (MVP)

**Obiettivo:** le funzioni più usate della categoria, risolvendo i problemi ricorrenti degli strumenti esistenti (affidabilità, prestazioni, UX, mobile, pause troppo grossolane) e introducendo i differenziatori a basso costo e alto impatto.

| Area | Inclusi in R1 |
|---|---|
| Modello e semantica | SEM-01…09 |
| Target | MAT-01…09, MAT-13, MAT-16…19, MAT-22 |
| Pianificazione | SCH-01…04, SCH-06, SCH-07 |
| Budget | LIM-01…06, LIM-09…11 |
| Tempo | TIM-01…07 |
| Interventi | INT-01…07, INT-09, INT-12…14 |
| Applicazione dei blocchi | ENF-01…05, ENF-07…12 |
| Pause | BRK-01…10 |
| Focus | FOC-01…05, FOC-07, FOC-09 |
| Protezione | PRO-01…05, PRO-08, PRO-09, PRO-12…16, PRO-18, PRO-19 |
| Statistiche e motivazione | STA-01…04, STA-06, STA-07, MOT-01 |
| Feedback | NOT-01…04, NOT-06 |
| Dati | LST-01, LST-03, DAT-01…07 |
| Altro | API-01, API-02, ONB-01…07, DIA-01…03, SET-01…05 |
| Non funzionali | tutti i requisiti M di §7 |

**Criterio di uscita di R1:** tutti i requisiti M di R1 implementati e testati su Firefox desktop, Firefox Android e Chrome; test di usabilità con almeno 5 persone (USAB-01); nessun bug critico aperto.

### 9.2 R2 — v1.x "Precisione e frizione intelligente"

Rimozione degli elementi (ELM-*), filtri sui motori di ricerca (SRC-*), partner TOTP (PRO-06), hardening con policy e managed storage (PRO-10, PRO-11), Pomodoro (FOC-06), rotazione (INT-11), respiro (INT-08), ripresa dei media (INT-15), parole chiave nei contenuti (MAT-12), origine della navigazione (MAT-10), abbonamenti a liste (LST-02), rollover e tempo guadagnato (LIM-07, LIM-08), eccezioni di calendario (SCH-05), sessioni programmate (SCH-08), reality check (NOT-05), riepilogo settimanale (STA-05), streak indulgenti (MOT-03), automazione locale (API-03).

### 9.3 R3 — v2.x "Più dispositivi"

Sincronizzazione cifrata end-to-end (DAT-09), backup verso destinazioni dell'utente (DAT-08), categorie da liste pubbliche (MAT-21), coerenza dei budget tra dispositivi.

### 9.4 F — Ricerca e futuro

Coach LLM opzionale (INT-17), chiave di sicurezza come fattore di sblocco (PRO-07), companion nativo (API-04), condizioni di contesto (SCH-09), limite di tab aperte, valutazione dell'efficacia con dati esportati volontariamente per la ricerca.

---

## 10. Fuori ambito

| Voce | Motivo |
|---|---|
| Blocco di app native e di altri browser | Non è possibile da un'estensione; eventualmente in futuro tramite un companion (API-04). |
| Controllo parentale come caso d'uso primario | Modello di minaccia e requisiti diversi (amministratore ≠ utente). L'architettura non lo esclude. |
| Account, server o cloud del progetto | Contrario a VIN-02 e VIN-03. |
| Sincronizzazione in v1 | VIN-05; prevista in R3. |
| Monetizzazione tramite dati, pubblicità o upsell invasivi | ETH-01. |
| Gamification competitiva e social (classifiche) | Rischio di vergogna e di confronto; non supportata dalle evidenze. |
| Safari | Fuori dai target dichiarati. |
| Filtraggio DNS o di rete a livello di sistema | Fuori dal perimetro di un'estensione. |

---

## 11. Rischi e mitigazioni

| Rischio | Prob. | Impatto | Mitigazione |
|---|---|---|---|
| Lacune o regressioni delle API su Firefox Android | Media | Alto | Rilevamento delle funzionalità (REL-02), test su Android a ogni release (REL-03), canale beta. |
| Ulteriori restrizioni di MV3 o delle policy degli store | Media | Alto | Approccio DNR-first, nessun codice remoto, disclosure dei permessi chiara. |
| Scope creep (gli strumenti maturi accumulano anni di funzioni) | Alta | Medio | Perimetro R1 rigoroso; tutto il resto passa da Discussions e roadmap. |
| Manutenzione delle regole sugli elementi dei siti | Alta | Medio | Regole come dati (ELM-02), comunità, test automatici sui selettori, rilascio indipendente delle liste. |
| Utenti che si chiudono fuori da soli | Media | Alto | Uscita d'emergenza (PRO-15), anteprime (ONB-07), livelli spiegati. |
| Diffidenza verso il permesso "tutti i siti" | Alta | Medio | Open source, informativa chiara, nessuna rete, build riproducibili. |
| Prestazioni con liste enormi o molte regex | Media | Medio | Compilazione in DNR, limiti e fallback (PERF-05), diagnostica. |
| Sfide anti-elusione poco accessibili | Media | Medio | Alternative accessibili (A11Y-05). |
| Efficacia modesta o in calo nel tempo (abituazione) | Media | Medio | Varietà opzionale, contesto, frizione leggera ma sostenibile (P4, P5). |
| Bus factor (molti progetti open source della categoria dipendono da un solo manutentore) | Media | Alto | Governance aperta, documentazione, revisione del codice, più manutentori con diritti di release. |

---

## 12. Decisioni aperte

| # | Decisione | Opzioni | Raccomandazione |
|---|---|---|---|
| D1 | Licenza | GPL-3.0-or-later · MPL-2.0 · MIT | **GPL-3.0-or-later**: garantisce che i fork restino aperti e verificabili (gli utenti diffidano delle estensioni chiuse, vedi Unhook). |
| D2 | Manifest su Firefox | MV3 · MV2 (`webRequest` bloccante) | **MV3 su entrambi i browser**, con DNR come meccanismo primario; `webRequest` di Firefox solo per i casi limite, dietro un adattatore. |
| D3 | Framework UI | Svelte · Preact · Lit · vanilla | Scegliere tramite ADR dopo un prototipo, misurando bundle e memoria del popup. |
| D4 | Intervento predefinito nei template | Blocco · ritardo/intenzione | **Ritardo con domanda d'intenzione** per i siti "tentazione"; blocco per le finestre esplicite e le sessioni (P3, P4, P8). |
| D5 | Conservazione delle statistiche | per esempio 90 giorni di dettaglio e 2 anni di aggregati | Da validare con gli utenti; configurabile. |
| D6 | Nome dell'entità principale | "Gruppi" · "Regole" · "Set" | "Gruppi" (più comprensibile); da validare nei test di usabilità. |
| D7 | Attesa predefinita dell'uscita d'emergenza | 4 h · 24 h · 72 h | 24 h, configurabile tra 4 ore e 7 giorni. |
| D8 | Partner TOTP in R1 o R2 | — | R2, per contenere il perimetro di R1. |
| D9 | Hosting e firma delle liste comunitarie | Raw GitHub · release firmate | Release versionate con checksum; cambio di fonte sempre opt-in. |
| D10 | Codice | Riuso di codice esistente · scrittura da zero | Scrittura da zero con un'architettura propria. |
| D11 | Misurare l'efficacia senza telemetria | Nessuna misura · export volontario | Export anonimo volontario per studi, mai automatico. |

---

## 13. Criteri di accettazione esemplari

```gherkin
Funzionalità: Blocco prima della navigazione (ENF-01, ENF-08)
  Scenario: il sito bloccato non riceve richieste
    Dato un gruppo che blocca "example.com" sempre
    E il browser appena riavviato
    Quando l'utente digita "https://www.example.com/pagina"
    Allora viene mostrata la pagina di blocco di WebHandbrake
    E nessuna richiesta main_frame verso example.com risulta nel log di rete
```

```gherkin
Funzionalità: Fine della pausa (BRK-07, ENF-02)
  Scenario: la tab aperta viene ribloccata
    Dato una pausa di 5 minuti attiva sul gruppo "Video"
    E una tab aperta su "youtube.com/watch?v=abc" in primo piano
    Quando la pausa scade
    Allora entro 1 secondo la tab mostra l'intervento del gruppo
    E l'URL originale resta disponibile con il pulsante "Riapri"
```

```gherkin
Funzionalità: Asimmetria e cooling-off (PRO-02, PRO-03)
  Scenario: rafforzare è immediato anche con le impostazioni bloccate
    Dato il livello di protezione "Rigido" con impostazioni bloccate
    Quando l'utente aggiunge "news.example" al gruppo "Social"
    Allora la modifica è attiva immediatamente

  Scenario: indebolire richiede attesa e conferma
    Dato il livello "Rigido" con cooling-off di 24 h
    Quando l'utente rimuove "reddit.com" dal gruppo "Social"
    Allora la modifica compare in "Modifiche in sospeso"
    E reddit.com resta bloccato
    E dopo 24 h la modifica diventa "confermabile"
    E viene applicata solo dopo che l'utente preme "Conferma"
    E se non viene confermata entro 48 h decade
```

```gherkin
Funzionalità: Più gruppi sullo stesso URL (SEM-03, SEM-07)
  Scenario: vince l'intervento più grave, indipendentemente dall'ordine
    Dato il gruppo A che sul sito X mostra un ritardo di 30 s
    E il gruppo B che blocca il sito X fino alle 17:00
    Quando l'utente apre X alle 15:00
    Allora viene mostrato il blocco con sblocco previsto alle 17:00
    E riordinare A e B non cambia il risultato
```

```gherkin
Funzionalità: Conteggio del tempo (TIM-02, TIM-03)
  Scenario: nessun conteggio durante la sospensione e con più finestre
    Dato un budget di 30 min al giorno sul gruppo "Social"
    E due finestre visibili entrambe su siti del gruppo
    Quando passano 60 s con la prima finestra a fuoco
    Allora il budget diminuisce di 60 s, non di 120 s
    Quando il dispositivo resta sospeso per 2 ore
    Allora il budget non diminuisce durante la sospensione
```

```gherkin
Funzionalità: Periodo di grazia (INT-13)
  Scenario: l'utente sta scrivendo quando scade il tempo
    Dato il budget del gruppo "Social" che sta per esaurirsi
    E l'utente che sta digitando in un campo di testo della pagina
    Quando il budget si esaurisce
    Allora compare un countdown di 45 s con il pulsante "Copia la bozza"
    E al termine viene applicato l'intervento
```

```gherkin
Funzionalità: Spiegabilità (MAT-16)
  Scenario: "Perché?" su un URL
    Quando l'utente inserisce "reddit.com/r/rust/comments/123" in "Prova un URL"
    Allora vede il gruppo, il target e l'eventuale eccezione che corrispondono
    E l'intervento attuale e il prossimo cambiamento con data e ora
```

```gherkin
Funzionalità: Integrità dei dati (DAT-03)
  Scenario: configurazione corrotta
    Dato uno storage con la configurazione corrotta
    Quando l'estensione si avvia
    Allora ripristina automaticamente l'ultimo snapshot valido
    E mostra un avviso con la data dello snapshot ripristinato
```

```gherkin
Funzionalità: Uscita d'emergenza (PRO-15)
  Scenario: sessione non interrompibile avviata per errore
    Dato una sessione "non interrompibile" di 8 ore
    Quando l'utente avvia la procedura d'emergenza e digita la frase richiesta
    Allora parte un'attesa di 24 h annullabile
    E al termine la sessione può essere chiusa
    E l'evento viene registrato nel centro protezione
```

---

## 14. Tracciabilità delle richieste degli utenti

| Richiesta o problema (fonte) | Requisiti |
|---|---|
| Override con limite in tempo | BRK-04, BRK-08 |
| Blocco di iframe e risorse incorporate | MAT-13 |
| Pagina senza immagini e video | INT-16 |
| Motivo e registro degli override | BRK-06, STA-03 |
| Non perdere il commento in scrittura | INT-13 |
| Ripresa del video | INT-15 |
| Override per gruppo, pagina o URL | BRK-01, BRK-02, INT-14 |
| Limite di visite | LIM-04, SEM-08 |
| Note per gruppo | MOT-01, INT-01 |
| Limitare l'accesso alle opzioni | PRO-03, PRO-17 |
| Sfide alternative, divieto di incollare | INT-04 |
| Password per gruppo | PRO-16 |
| Date specifiche, ricorrenze mensili | SCH-05, BRK-04 |
| Statistiche dettagliate | STA-02 |
| Countdown nascosto o casuale | INT-02 |
| Sessione con allowlist | FOC-02 |
| Lockdown ritardato o programmato | FOC-04, SCH-08 |
| Durata scelta dall'utente | LIM-06, INT-03 |
| Tempo guadagnato | LIM-08 |
| Compatibilità della sintassi con uBO e AdGuard | MAT-05 |
| Molti gruppi, sotto-gruppi | SET-04, MAT-18 |
| API per programmi esterni | API-03 |
| Fasce notturne (Doc, GH) | SCH-01 |
| Sincronizzazione | DAT-09 (R3) |
| CPU alta, molte tab (GH, AMO) | PERF-01, PERF-03 |
| Impostazioni perse (GH, AMO) | DAT-03, DAT-07, REL-01 |
| Conteggio durante la sospensione | TIM-02, SCH-07 |
| Android: conteggio ad app minimizzata | TIM-04 |
| Android rotto da API mancante | REL-02, API-01 |
| Bypass in incognito (AMO, Chrome Web Store) | PRO-09, PRO-10 |
| Pagina caricata prima del blocco, cookie (AMO:block-website, AMO:blocksite) | ENF-01 |
| Pausa che non riblocca (AMO:impulse-blocker) | BRK-07, ENF-02 |
| Tab distrutte (AMO:block-website) | ENF-04 |
| Elementi che si rompono a ogni restyling (AMO:unhook, socialfocus) | ELM-02, MAINT-05 |
| Tono colpevolizzante (AMO:one-sec) | INT-01, §8.5, ETH-04 |
| Opzioni bloccate per sempre | PRO-15 |
| ReDoS nelle regex importate | SEC-03 |
| Aggiramento riordinando i gruppi | SEM-03 |
| Eccezione che sopprime i timer di altri gruppi | SEM-04, TIM-07 |

---

## Appendice A — Vettori di elusione e contromisure

| # | Vettore | Contromisura in WebHandbrake | Efficacia |
|---|---|---|---|
| 1 | Disattivare o disinstallare l'estensione | Blocco delle pagine di gestione durante le protezioni (PRO-08); registro delle manomissioni alla riattivazione (PRO-13); policy di installazione forzata (PRO-10) | Media; alta con le policy |
| 2 | Finestre private / incognito | Verifica e avviso (PRO-09); policy per disattivare la navigazione privata (PRO-10) | Media; alta con le policy |
| 3 | Altri browser | Fuori dal controllo di un'estensione; suggerimenti nel centro protezione; companion futuro (API-04) | Bassa |
| 4 | Nuovo profilo o modalità ospite | Policy (`BrowserGuestModeEnabled`, `BrowserAddPersonEnabled` su Chrome; suggerimenti per Firefox) | Media |
| 5 | Modalità provvisoria di Firefox | Policy `DisableSafeMode` (PRO-10) | Alta con la policy |
| 6 | Modificare l'orologio di sistema | Rilevamento dei salti e confronto con le intestazioni `Date` (SCH-07); registro | Media |
| 7 | Devtools sulle pagine dell'estensione | Logica imposta dal background (PRO-14); policy per disattivare i devtools (PRO-10) | Alta |
| 8 | Modificare lo storage via `about:debugging` | Blocco di `about:debugging` (PRO-08); verifica di coerenza all'avvio | Media |
| 9 | Reinstallare per azzerare le impostazioni | Managed storage (PRO-11); registro; promemoria di backup | Media |
| 10 | Importare una configurazione più permissiva | Import trattato come indebolimento (PRO-12) | Alta |
| 11 | Riordinare i gruppi per cambiare la precedenza | Vince sempre il più grave (SEM-03) | Alta |
| 12 | Copiare il codice casuale dal DOM | Testo disegnato su canvas (INT-04) | Alta |
| 13 | Incollare nel campo della sfida | Incolla disabilitato, solo eventi `isTrusted` (INT-04) | Alta |
| 14 | Mirror, proxy, cache, traduttori, frontend alternativi | Liste curate (MAT-14) e template (LST-01) | Media |
| 15 | Contenuti incorporati in altri siti | Blocco dei sub-frame (MAT-13) | Alta |
| 16 | Tasto Indietro / bfcache | Ricontrollo su `pageshow` (ENF-10) | Alta |
| 17 | Navigazione SPA senza ricaricare | `onHistoryStateUpdated` e content script (ENF-03) | Alta |
| 18 | Salvare la pagina dal link nella pagina di blocco | Opzione per nascondere l'URL (INT-01) | Alta |
| 19 | Cambiare fuso orario | Budget legati all'istante UTC con confini dei giorni coerenti; rilevamento del cambio (SCH-06) | Alta |
| 20 | Revocare i permessi host per sito | Rilevamento, avviso e fallback al blocco di rete (ENF-12) | Media |
| 21 | Modalità lettura, `view-source:` | Gestione esplicita degli URL (TIM-06, ENF-03) | Media |
| 22 | Web app installate, widget | Best effort (ENF-13) | Bassa |
| 23 | Altri dispositivi e app native | Fuori ambito | — |
| 24 | Manipolare i timer con le opzioni sulle tab inattive | Contabilità calcolata nel background (TIM-03) | Alta |

> **Posizione etica.** Nessuna estensione può essere inaggirabile per chi ha pieno controllo del proprio dispositivo. L'obiettivo è alzare il **costo d'attivazione** dell'elusione sopra quello dell'impulso, come osservato su HN: *"It doesn't need to be impossible"*. Chi vuole di più può usare le policy di sistema, in modo consapevole e reversibile.

---

## Appendice B — Compatibilità delle API WebExtension

Fonte: MDN browser-compat-data 8.1.4 (2026-10-01). "✖" indica che l'API non è supportata.

| API | Chrome | Firefox | Firefox Android | Uso in WebHandbrake |
|---|---|---|---|---|
| `declarativeNetRequest` (dinamiche, di sessione) | 84 / 90 | 113 | 113 | Blocco e redirect prima della navigazione |
| `webNavigation` (incluso `onHistoryStateUpdated`) | 16 / 22 | 45 / 47 | 48 | SPA, `transitionType` |
| `webRequest` (osservazionale) | ✅ | ✅ (anche bloccante) | ✅ | Intestazioni `Date` (SCH-07), casi limite |
| `tabs` (`onActivated`, `update`, `query`) | ✅ | ✅ | ✅ (`query` parziale) | Applicazione ai cambi di stato |
| `windows` / `onFocusChanged` | ✅ | ✅ | ✖ | Focus su desktop; su Android si usa `visibilitychange` |
| `idle` | ✅ | ✅ | ✅ | Inattività e schermo bloccato |
| `alarms` | ✅ (minimo 30 s) | ✅ | ✅ | Transizioni pianificate |
| `storage.local` / `storage.session` | ✅ / 102 | ✅ / 115 | ✅ / 115 | Stato persistente e volatile |
| `storage.managed` | 33 | 57 | ✖ | PRO-11 |
| `storage.sync` | ✅ | ✅ | ◐ (non sincronizza) | Non usato in v1 |
| `scripting` (`registerContentScripts`) | 96 | 102 | 102 | Overlay, ELM |
| `action` (badge, popup) | 88 | 109 | 109 | Popup, badge |
| `notifications` | ✅ | ✅ | ✅ | NOT-04 |
| `permissions.request` | ✅ | 55 | 120 | Permessi facoltativi |
| `extension.isAllowedIncognitoAccess` | ✅ | ✅ | ✅ | PRO-09 |
| `commands` | ✅ | ✅ | ✖ | API-01 (solo desktop) |
| `menus` / `contextMenus` | ✅ | ✅ | ✖ | API-02 (solo desktop) |
| `history` | ✅ | ✅ | ✖ | ENF-06 (solo desktop) |
| `sessions` | ✅ | ✅ | ✖ | Non indispensabile |
| `runtime.setUninstallURL` | 115 | 116 | 116 | Disattivato per default (PRO-19) |

---

## Appendice C — Bibliografia e fonti

### C.1 Letteratura scientifica

- **[P1]** Lyngs, U., Lukoff, K., Slovak, P., Binns, R., Slack, A., Inzlicht, M., Van Kleek, M., Shadbolt, N. (2019). *Self-Control in Cyberspace: Applying Dual Systems Theory to a Review of Digital Self-Control Tools.* CHI '19. <https://arxiv.org/abs/1902.00157>
- **[P2]** Monge Roffarello, A., De Russis, L. (2023). *Achieving Digital Wellbeing Through Digital Self-Control Tools: A Systematic Review and Meta-Analysis.* ACM TOCHI 30(4). <https://iris.polito.it/handle/11583/2972709>
- **[P3]** Grüning, D. J., Riedel, F., Lorenz-Spreen, P. (2023). *Directing smartphone use through the self-nudge app one sec.* PNAS 120(8). <https://pmc.ncbi.nlm.nih.gov/articles/PMC9974409>
- **[P4]** Haliburton, L. et al. (2024). *A Longitudinal In-the-Wild Investigation of Design Frictions to Prevent Smartphone Overuse.* CHI '24. <https://doi.org/10.1145/3613904.3642370>
- **[P5]** Kovacs, G., Wu, Z., Bernstein, M. S. (2018). *Rotating Online Behavior Change Interventions Increases Effectiveness But Also Increases Attrition.* CSCW '18. <https://hci.stanford.edu/publications/paper.php?id=351>
- **[P6]** Kovacs, G. et al. (2019). *Conservation of Procrastination: Do Productivity Interventions Save Time or Just Redistribute It?* CHI '19. <https://hci.stanford.edu/publications/paper.php?id=354>
- **[P7]** Kovacs, G., Wu, Z., Bernstein, M. S. (2021). *Not Now, Ask Later: Users Weaken Their Behavior Change Regimen Over Time, But Expect To Re-Strengthen It Imminently.* CHI '21. <https://arxiv.org/abs/2101.11743>
- **[P8]** Kim, J., Jung, H., Ko, M., Lee, U. (2019). *GoalKeeper: Exploring Interaction Lockout Mechanisms for Regulating Smartphone Use.* IMWUT 3(1). <https://doi.org/10.1145/3314403>
- **[P9]** Mark, G., Czerwinski, M., Iqbal, S. T. (2018). *Effects of Individual Differences in Blocking Workplace Distractions.* CHI '18. <https://www.microsoft.com/en-us/research/publication/effects-individual-differences-blocking-workplace-distractions/>
- **[P10]** Lyngs, U. et al. (2020). *'I Just Want to Hack Myself to Not Get Distracted': Evaluating Design Interventions for Self-Control on Facebook.* CHI '20. <https://arxiv.org/abs/2001.04180>
- **[P11]** Lukoff, K. et al. (2021). *How the Design of YouTube Influences User Sense of Agency.* CHI '21. <https://arxiv.org/abs/2101.11778>
- **[P12]** Zhang, M. R., Lukoff, K., Rao, R., Baughan, A., Hiniker, A. (2022). *Monitoring Screen Time or Redesigning It? Two Approaches to Supporting Intentional Social Media Use.* CHI '22.
- **[P13]** Tseng, V. W.-S., Lee, M. L., Denoue, L., Avrahami, D. (2019). *Overcoming Distractions during Transitions from Break to Work Using a Conversational Website-Blocking System.* CHI '19. <https://doi.org/10.1145/3290605.3300697>
- **[P14]** Okeke, F., Sobolev, M., Dell, N., Estrin, D. (2018). *Good Vibrations: Can a Digital Nudge Reduce Digital Overload?* MobileHCI '18. <https://par.nsf.gov/servlets/purl/10348463>
- **[P15]** Whittaker, S., Kalnikaite, V., Hollis, V., Guydish, A. (2016). *'Don't Waste My Time': Use of Time Information Improves Focus.* CHI '16.
- **[P16]** Xu, X. et al. (2022). *TypeOut: Leveraging Just-in-Time Self-Affirmation for Smartphone Overuse Reduction.* CHI '22. <https://par.nsf.gov/servlets/purl/10442493>
- **[P17]** Dekker, C. A., Baumgartner, S. E. (2023). *Is life brighter when your phone is not? The efficacy of a grayscale smartphone intervention addressing digital well-being.* Mobile Media & Communication. <https://journals.sagepub.com/doi/10.1177/20501579231212062>
- **[P18]** Holte, A. J. et al. Studi sull'impostazione in scala di grigi (University of Cincinnati). <https://uc.edu/news/articles/2022/10/n21124601.html>
- **[P19]** Allcott, H., Gentzkow, M., Song, L. (2022). *Digital Addiction.* American Economic Review 112(7). <https://www.nber.org/papers/w28936>
- **[P20]** Duckworth, A. L., Gendler, T. S., Gross, J. J. (2016). *Situational Strategies for Self-Control.* Perspectives on Psychological Science 11(1). <https://pmc.ncbi.nlm.nih.gov/articles/PMC4736542/>
- **[P21]** Gollwitzer, P. M., Sheeran, P. (2006). *Implementation Intentions and Goal Achievement: A Meta-Analysis of Effects and Processes.* Advances in Experimental Social Psychology 38.
- **[P22]** Ariely, D., Wertenbroch, K. (2002). *Procrastination, Deadlines, and Performance: Self-Control by Precommitment.* Psychological Science 13(3). <https://doi.org/10.1111/1467-9280.00441>
- **[P23]** Rixen, J. O. et al. (2023). *The Loop and Reasons to Break It: Investigating Infinite Scrolling Behaviour in Social Media Applications and Reasons to Stop.* MobileHCI '23.
- **[P24]** *Design Frictions on Social Media: Balancing Reduced Mindless Scrolling and User Satisfaction* (2024). <https://arxiv.org/abs/2407.18803>
- **[P25]** *Scrolling in the Deep: Analysing Contextual Influences on Intervention Effectiveness during Infinite Scrolling on Social Media* (2025). <https://arxiv.org/abs/2501.11814>
- **[P26]** Monge Roffarello, A., De Russis, L. (2019). *The Race Towards Digital Wellbeing: Issues and Opportunities.* CHI '19. <https://doi.org/10.1145/3290605.3300616>
- **[P27]** Wohl, M. J. A., Pychyl, T. A., Bennett, S. H. (2010). *I forgive myself, now I can study: How self-forgiveness for procrastinating can reduce future procrastination.* Personality and Individual Differences 48(7).
- **[P28]** Hiniker, A., Hong, S. R., Kohno, T., Kientz, J. A. (2016). *MyTime: Designing and Evaluating an Intervention for Smartphone Non-Use.* CHI '16.
- **[P29]** Ko, M. et al. (2015). *NUGU: A Group-Based Intervention App for Improving Self-Regulation of Limiting Smartphone Use.* CSCW '15.
- **[P30]** Kim, Y.-H. et al. (2016). *TimeAware: Leveraging Framing Effects to Enhance Personal Productivity.* CHI '16.

### C.2 Domini adiacenti

- **[X1]** UK Gambling Commission, *Remote gambling and software technical standards — RTS 12: Financial limits.* <https://www.gamblingcommission.gov.uk/manual/remote-gambling-and-software-technical-standards/rts-12-financial-limits>
- **[X2]** Bitwarden, *Emergency Access.* <https://bitwarden.com/help/emergency-access/>
- **[X3]** uBlock Origin, AdGuard, uBlacklist: documentazione dei progetti. <https://github.com/gorhill/uBlock> · <https://github.com/iorate/ublacklist>

### C.3 Fonti tecniche

- **[T1]** MDN browser-compat-data 8.1.4 (2026-10-01). <https://github.com/mdn/browser-compat-data>
- **[T2]** Chrome for Developers, *chrome.declarativeNetRequest.* <https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest>
- **[T3]** Chrome for Developers, *The extension service worker lifecycle.* <https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle>

### C.4 Prodotti analizzati

- Pagine AMO e recensioni (API `addons.mozilla.org/api/v5`): `block-website`, `blocksite`, `impulse-blocker`, `freedom-website-blocker`, `one-sec`, `news-feed-eradicator`, `stayfree`, `besttimetracker`, `forest-stay-focused-be-present`, `socialfocus`, `ublacklist`, `df-youtube`, `youtube-recommended-videos`.
- Cold Turkey Blocker — funzionalità. <https://getcoldturkey.com/features>
- StayFocusd — scheda su Edge Add-ons. <https://microsoftedge.microsoft.com/addons/detail/stayfocusd/lahgekkpgepaollpapdonfpdiiggjoch>
- BlockSite. <https://blocksite.co/>
- Freedom. <https://freedom.to/features>
- Intention. <https://github.com/MaybeItsSoftware/intention>
- Time Tracker — Web Habit Builder. <https://github.com/sheepzh/time-tracker-4-browser>
- Mindful (Android). <https://github.com/akaMrNagar/Mindful>
- HabitLab. <https://purl.stanford.edu/qq438qv1791>
- Hacker News (API Algolia): ricerche su "website blocker extension", "cold turkey blocker", "stayfocusd", "one sec app friction".
