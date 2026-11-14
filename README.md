# Dimensione Reale

Un sito statico per vedere PDF, Word `.docx` e Photoshop `.psd`/`.psb` alle dimensioni di stampa desiderate. I documenti sono elaborati nel browser: non vengono inviati al sito né a un server.

**Sito pubblico:** [framax444.github.io/Real-Size-Doc](https://framax444.github.io/Real-Size-Doc/)

## Uso

1. Apri il sito e scegli un file.
2. Premi **Misura di stampa**, inserisci larghezza e altezza in centimetri e applica. Le pagine successive vengono ridimensionate nello stesso rapporto della prima.
3. Scorri in verticale o in orizzontale quando il documento è più grande della finestra.
4. Il sito rileva la risoluzione del display per la scala iniziale. Per una dimensione fisica 1:1 precisa, usa **Calibra schermo** con una carta standard larga 85,6 mm. Il browser non fornisce la dimensione fisica del monitor.

La misura di stampa modifica l'anteprima, non il file originale. Per ottenere la stessa misura su carta, imposta le dimensioni nelle opzioni di stampa. I vecchi file Word `.doc` vanno salvati come `.docx` o PDF.

## Avvio locale

```sh
python3 -m http.server 8765
```

Apri [http://127.0.0.1:8765](http://127.0.0.1:8765).

## Pubblicazione

Il sito è pubblicato con GitHub Pages dalla radice del ramo `main` del repository [FRAMAX444/Real-Size-Doc](https://github.com/FRAMAX444/Real-Size-Doc). Tutte le librerie sono incluse in `static/vendor`, perciò non serve un servizio di conversione o una CDN.

## Librerie

- PDF.js (`pdfjs-dist` 6.5.438), Apache-2.0
- docx-preview 0.4.1, Apache-2.0
- JSZip 3.10.1, MIT/GPL-3.0
- ag-psd 34.2.0, MIT
