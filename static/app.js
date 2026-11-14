import { getDocument, GlobalWorkerOptions } from './vendor/pdf.mjs';

GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.mjs', import.meta.url).href;

const $ = (selector) => document.querySelector(selector);
const els = {
  landing: $('#landing'), workspace: $('#workspace'), fileInput: $('#fileInput'),
  newFileButton: $('#newFileButton'), dropzone: $('#dropzone'), viewer: $('#viewer'),
  pageStack: $('#pageStack'), fileIcon: $('#fileIcon'), fileName: $('#fileName'),
  fileDetails: $('#fileDetails'), calibrationButton: $('#calibrationButton'),
  calibrationPanel: $('#calibrationPanel'), scaleRange: $('#scaleRange'),
  referenceCard: $('#referenceCard'), zoomValue: $('#zoomValue'),
  scaleStatus: $('#scaleStatus'), calibrationStatus: $('#calibrationStatus'),
  printSizeButton: $('#printSizeButton'), printPanel: $('#printPanel'),
  printWidth: $('#printWidth'), printHeight: $('#printHeight'),
  lockProportions: $('#lockProportions'), resetPrintSize: $('#resetPrintSize'),
  printStatus: $('#printStatus'), screenInfo: $('#screenInfo'), toast: $('#toast')
};

const CSS_PX_PER_MM = 96 / 25.4;
const CALIBRATION_KEY = 'dimensione-reale-screen-calibration-v2';
const screenSignature = () => `${screen.width}x${screen.height}@${devicePixelRatio}`;
let savedCalibration;
try { savedCalibration = JSON.parse(localStorage.getItem(CALIBRATION_KEY) || 'null'); } catch { savedCalibration = null; }
let pxPerMm = savedCalibration?.screen === screenSignature() ? savedCalibration.value : CSS_PX_PER_MM;
let calibrated = Number.isFinite(pxPerMm) && pxPerMm >= 1.5 && pxPerMm <= 9 && savedCalibration?.screen === screenSignature();
if (!calibrated) pxPerMm = CSS_PX_PER_MM;
let zoom = 1;
let documentData = null;
let psdPpi = 72;
let printTarget = null;
let wordView = null;
let pdfObserver = null;
let toastTimer;

function showToast(message, error = false) {
  els.toast.textContent = message;
  els.toast.classList.toggle('error', error);
  els.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 4500);
}

function formatMm(value) {
  return new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 }).format(value);
}

function cmInput(mm) { return String(+(mm / 10).toFixed(2)); }

function originalPages() {
  if (!documentData) return [];
  if (documentData.kind === 'photoshop') {
    const image = documentData.image;
    return [{ widthMm: image.widthPx / (image.ppiX || psdPpi) * 25.4,
              heightMm: image.heightPx / (image.ppiY || psdPpi) * 25.4 }];
  }
  return documentData.pages;
}

function printedSize(page) {
  if (!printTarget) return page;
  const first = originalPages()[0];
  return { widthMm: page.widthMm * printTarget.widthMm / first.widthMm,
           heightMm: page.heightMm * printTarget.heightMm / first.heightMm };
}

function updateDocumentInfo() {
  if (!documentData) return;
  if (documentData.kind === 'photoshop') {
    const image = documentData.image;
    els.fileDetails.textContent = `${image.widthPx} × ${image.heightPx} px${image.ppiX ? ` · ${formatMm(image.ppiX)} PPI` : ' · PPI da specificare'}`;
  } else {
    els.fileDetails.textContent = `${documentData.pages.length} ${documentData.pages.length === 1 ? 'pagina' : 'pagine'} · ${pageSize(originalPages()[0])} · ${documentData.kind === 'word' ? 'Word' : 'PDF'}`;
  }
  els.printStatus.textContent = printTarget ? ` · Stampa: ${cmInput(printTarget.widthMm)} × ${cmInput(printTarget.heightMm)} cm` : '';
  els.printSizeButton.classList.toggle('is-active', Boolean(printTarget));
  els.resetPrintSize.disabled = !printTarget;
}

function updateScale() {
  els.scaleRange.value = pxPerMm;
  const cardWidth = 85.6 * pxPerMm;
  els.referenceCard.style.width = `${cardWidth}px`;
  els.referenceCard.style.height = `${53.98 * pxPerMm}px`;
  els.referenceCard.style.padding = `${Math.max(12, 5 * pxPerMm)}px`;
  els.zoomValue.textContent = `${Math.round(zoom * 100)}%`;
  els.scaleStatus.textContent = zoom === 1 ? (calibrated ? 'Scala 1:1' : 'Scala 1:1 stimata') : `Vista ${Math.round(zoom * 100)}%`;
  els.calibrationStatus.textContent = calibrated ? 'Schermo calibrato' : 'Calibrazione consigliata';
  for (const shell of els.pageStack.querySelectorAll('.page-shell')) {
    const width = Number(shell.dataset.widthMm) * pxPerMm * zoom;
    const height = Number(shell.dataset.heightMm) * pxPerMm * zoom;
    shell.style.width = `${width}px`;
    const paper = shell.querySelector('.paper');
    paper.style.width = `${width}px`;
    paper.style.height = `${height}px`;
  }
  if (wordView) {
    const first = printedSize(originalPages()[0]);
    const x = first.widthMm * pxPerMm * zoom / wordView.firstWidthPx;
    const y = first.heightMm * pxPerMm * zoom / wordView.firstHeightPx;
    wordView.content.style.transform = `scale(${x}, ${y})`;
    wordView.frame.style.width = `${wordView.contentWidthPx * x}px`;
    wordView.frame.style.height = `${wordView.contentHeightPx * y}px`;
  }
}

function pageSize(page) {
  return `${formatMm(page.widthMm)} × ${formatMm(page.heightMm)} mm`;
}

function renderPages() {
  if (pdfObserver) pdfObserver.disconnect();
  pdfObserver = null;
  wordView = null;
  const previousTop = els.viewer.scrollTop;
  const previousLeft = els.viewer.scrollLeft;
  els.pageStack.replaceChildren();
  if (documentData.kind === 'photoshop') {
    const image = documentData.image;
    if (!printTarget && (!image.ppiX || !image.ppiY)) {
      const notice = document.createElement('div');
      notice.className = 'ppi-notice';
      notice.innerHTML = 'Questo file non indica la risoluzione di stampa. Inserisci i <label for="ppiInput">PPI <input id="ppiInput" type="number" min="1" max="2400" step="1" value="72"></label> oppure scegli direttamente la <b>Misura di stampa</b>.';
      notice.querySelector('input').value = psdPpi;
      notice.querySelector('input').addEventListener('change', (event) => {
        const value = Number(event.target.value);
        if (value >= 1 && value <= 2400) { psdPpi = value; renderPages(); updatePrintInputs(); }
      });
      els.pageStack.append(notice);
    }
    els.pageStack.append(createPage(1, printedSize(originalPages()[0]), true));
  } else {
    documentData.pages.forEach((page, index) => els.pageStack.append(createPage(index + 1, printedSize(page), false)));
    pdfObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) {
        pdfObserver.unobserve(entry.target);
        drawPdfPage(entry.target);
      }
    }, { root: els.viewer, rootMargin: '600px' });
    els.pageStack.querySelectorAll('.page-shell').forEach((shell) => pdfObserver.observe(shell));
  }
  updateScale();
  els.viewer.scrollTop = previousTop;
  els.viewer.scrollLeft = previousLeft;
}

function createPage(number, size, photoshop) {
  const shell = document.createElement('article');
  shell.className = 'page-shell';
  shell.dataset.widthMm = size.widthMm;
  shell.dataset.heightMm = size.heightMm;
  const width = size.widthMm * pxPerMm * zoom;
  const height = size.heightMm * pxPerMm * zoom;
  shell.style.width = `${width}px`;
  const heading = document.createElement('div');
  heading.className = 'page-number';
  const label = document.createElement('span');
  label.textContent = photoshop ? 'IMMAGINE' : `PAGINA ${number.toString().padStart(2, '0')}`;
  const dimensions = document.createElement('span');
  dimensions.textContent = pageSize(size);
  heading.append(label, dimensions);
  const paper = document.createElement('div');
  paper.className = `paper loading${photoshop ? ' psd' : ''}`;
  paper.style.width = `${width}px`;
  paper.style.height = `${height}px`;
  if (photoshop) {
    paper.append(documentData.canvas);
    paper.classList.remove('loading');
  } else {
    const canvas = document.createElement('canvas');
    canvas.className = 'page-canvas';
    canvas.setAttribute('aria-label', `Pagina ${number} di ${documentData.name}`);
    paper.append(canvas);
    shell.dataset.pageNumber = number;
  }
  shell.append(heading, paper);
  return shell;
}

async function drawPdfPage(shell) {
  if (shell.dataset.rendering || shell.dataset.rendered) return;
  shell.dataset.rendering = 'true';
  const number = Number(shell.dataset.pageNumber);
  try {
    const page = await documentData.pdf.getPage(number);
    let viewport = page.getViewport({ scale: 160 / 72 });
    const pixels = viewport.width * viewport.height;
    if (pixels > 18000000) viewport = page.getViewport({ scale: 160 / 72 * Math.sqrt(18000000 / pixels) });
    const canvas = shell.querySelector('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    shell.querySelector('.paper').classList.remove('loading');
    shell.dataset.rendered = 'true';
  } catch {
    shell.querySelector('.paper').textContent = `Impossibile mostrare la pagina ${number}`;
    shell.querySelector('.paper').classList.remove('loading');
  } finally {
    delete shell.dataset.rendering;
  }
}

function readPsdResolution(buffer) {
  const bytes = new DataView(buffer);
  if (bytes.byteLength < 34 || bytes.getUint32(0) !== 0x38425053) throw new Error('Il file Photoshop non è valido');
  const widthPx = bytes.getUint32(18);
  const heightPx = bytes.getUint32(14);
  let offset = 26;
  offset += 4 + bytes.getUint32(offset);
  const resourcesEnd = offset + 4 + bytes.getUint32(offset);
  offset += 4;
  let ppiX = null, ppiY = null;
  while (offset + 12 <= Math.min(resourcesEnd, bytes.byteLength)) {
    if (bytes.getUint32(offset) !== 0x3842494d) break;
    offset += 4;
    const id = bytes.getUint16(offset); offset += 2;
    const nameLength = bytes.getUint8(offset++);
    offset += nameLength + (nameLength % 2 === 0 ? 1 : 0);
    if (offset + 4 > bytes.byteLength) break;
    const length = bytes.getUint32(offset); offset += 4;
    if (id === 1005 && length >= 16 && offset + length <= bytes.byteLength) {
      const x = bytes.getUint32(offset) / 65536;
      const y = bytes.getUint32(offset + 8) / 65536;
      ppiX = bytes.getUint16(offset + 4) === 2 ? x * 2.54 : x;
      ppiY = bytes.getUint16(offset + 12) === 2 ? y * 2.54 : y;
      break;
    }
    offset += length + (length % 2);
  }
  return { widthPx, heightPx, ppiX, ppiY };
}

async function loadPdf(file) {
  const pdf = await getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  if (pdf.numPages > 500) throw new Error('Il PDF può avere al massimo 500 pagine');
  const pages = [];
  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number);
    const size = page.getViewport({ scale: 1 });
    pages.push({ widthMm: size.width * 25.4 / 72, heightMm: size.height * 25.4 / 72 });
  }
  return { kind: 'pdf', name: file.name, pdf, pages };
}

async function loadPhotoshop(file) {
  const buffer = await file.arrayBuffer();
  const image = readPsdResolution(buffer);
  const psd = window.agPsd.readPsd(buffer, { skipLayerImageData: true });
  if (!psd.canvas) throw new Error('Il file Photoshop non contiene un’anteprima composita');
  psd.canvas.className = 'page-canvas';
  psd.canvas.setAttribute('aria-label', file.name);
  return { kind: 'photoshop', name: file.name, image, canvas: psd.canvas };
}

async function renderWord(file) {
  els.pageStack.replaceChildren();
  const styles = document.createElement('div');
  const frame = document.createElement('div');
  frame.className = 'word-frame';
  const content = document.createElement('div');
  content.className = 'word-content';
  frame.append(content);
  els.pageStack.append(styles, frame);
  await window.docx.renderAsync(file, content, styles, { inWrapper: false, breakPages: true });
  const sections = [...content.querySelectorAll('section.docx')];
  if (!sections.length) throw new Error('Impossibile leggere le pagine Word');
  documentData.pages = sections.map((section) => ({
    widthMm: section.offsetWidth / CSS_PX_PER_MM,
    heightMm: section.offsetHeight / CSS_PX_PER_MM
  }));
  const first = sections[0];
  wordView = { frame, content, firstWidthPx: first.offsetWidth,
               firstHeightPx: first.offsetHeight,
               contentWidthPx: Math.max(...sections.map((section) => section.offsetWidth)),
               contentHeightPx: content.scrollHeight };
  updateScale();
}

function updatePrintInputs() {
  if (!documentData || !originalPages().length) return;
  const size = printTarget || originalPages()[0];
  els.printWidth.value = cmInput(size.widthMm);
  els.printHeight.value = cmInput(size.heightMm);
  updateDocumentInfo();
}

async function openFile(file) {
  if (!file) return;
  if (/\.doc$/i.test(file.name)) {
    showToast('Salva il vecchio file .doc come .docx o PDF per aprirlo nel sito.', true);
    return;
  }
  if (!/\.(pdf|docx|psd|psb)$/i.test(file.name)) {
    showToast('Usa un file PDF, Word .docx, PSD o PSB.', true);
    return;
  }
  if (file.size > 100 * 1024 * 1024) {
    showToast('Il file deve essere più piccolo di 100 MB.', true);
    return;
  }
  document.body.classList.add('busy');
  els.newFileButton.disabled = true;
  showToast('Apertura del documento sul tuo dispositivo…');
  try {
    if (/\.pdf$/i.test(file.name)) documentData = await loadPdf(file);
    else if (/\.(psd|psb)$/i.test(file.name)) documentData = await loadPhotoshop(file);
    else documentData = { kind: 'word', name: file.name, pages: [] };
    printTarget = null;
    psdPpi = 72;
    zoom = 1;
    wordView = null;
    if (pdfObserver) pdfObserver.disconnect();
    els.fileName.textContent = documentData.name;
    els.fileIcon.textContent = documentData.kind === 'photoshop' ? 'PSD' : documentData.kind === 'word' ? 'DOCX' : 'PDF';
    els.landing.classList.add('hidden');
    els.workspace.classList.remove('hidden');
    els.viewer.scrollTop = 0;
    els.viewer.scrollLeft = 0;
    if (documentData.kind === 'word') await renderWord(file);
    else renderPages();
    updatePrintInputs();
    updateScale();
    els.toast.classList.add('hidden');
  } catch (error) {
    showToast(error.message || 'Impossibile aprire il documento', true);
  } finally {
    document.body.classList.remove('busy');
    els.newFileButton.disabled = false;
    els.fileInput.value = '';
  }
}

els.newFileButton.addEventListener('click', () => els.fileInput.click());
els.dropzone.addEventListener('click', () => els.fileInput.click());
els.fileInput.addEventListener('change', (event) => openFile(event.target.files[0]));
for (const eventName of ['dragenter', 'dragover']) {
  els.dropzone.addEventListener(eventName, (event) => { event.preventDefault(); els.dropzone.classList.add('dragover'); });
}
for (const eventName of ['dragleave', 'drop']) {
  els.dropzone.addEventListener(eventName, (event) => { event.preventDefault(); els.dropzone.classList.remove('dragover'); });
}
els.dropzone.addEventListener('drop', (event) => openFile(event.dataTransfer.files[0]));
document.addEventListener('dragover', (event) => event.preventDefault());
document.addEventListener('drop', (event) => {
  event.preventDefault();
  if (!els.dropzone.contains(event.target)) openFile(event.dataTransfer.files[0]);
});

function closePanel(panel, button) {
  panel.classList.add('hidden');
  button.setAttribute('aria-expanded', 'false');
}

els.printSizeButton.addEventListener('click', () => {
  const opening = els.printPanel.classList.contains('hidden');
  closePanel(els.calibrationPanel, els.calibrationButton);
  els.printPanel.classList.toggle('hidden', !opening);
  els.printSizeButton.setAttribute('aria-expanded', String(opening));
  if (opening) updatePrintInputs();
});

function syncProportions(changed) {
  if (!els.lockProportions.checked || !documentData) return;
  const first = originalPages()[0];
  if (changed === 'width') {
    const width = Number(els.printWidth.value);
    if (width > 0) els.printHeight.value = cmInput(width * 10 * first.heightMm / first.widthMm);
  } else {
    const height = Number(els.printHeight.value);
    if (height > 0) els.printWidth.value = cmInput(height * 10 * first.widthMm / first.heightMm);
  }
}
els.printWidth.addEventListener('input', () => syncProportions('width'));
els.printHeight.addEventListener('input', () => syncProportions('height'));
els.lockProportions.addEventListener('change', () => syncProportions('width'));
els.printPanel.addEventListener('submit', (event) => {
  event.preventDefault();
  const width = Number(els.printWidth.value);
  const height = Number(els.printHeight.value);
  if (!(width >= .1 && width <= 300 && height >= .1 && height <= 300)) {
    showToast('Inserisci larghezza e altezza tra 0,1 e 300 cm.', true);
    return;
  }
  printTarget = { widthMm: width * 10, heightMm: height * 10 };
  zoom = 1;
  if (documentData.kind === 'word') updateScale();
  else renderPages();
  updateDocumentInfo();
  closePanel(els.printPanel, els.printSizeButton);
  showToast(`Anteprima impostata a ${width} × ${height} cm.`);
});
els.resetPrintSize.addEventListener('click', () => {
  printTarget = null;
  zoom = 1;
  if (documentData.kind === 'word') updateScale();
  else renderPages();
  updatePrintInputs();
  closePanel(els.printPanel, els.printSizeButton);
  showToast('Ripristinate le dimensioni del file.');
});

els.calibrationButton.addEventListener('click', () => {
  const opening = els.calibrationPanel.classList.contains('hidden');
  closePanel(els.printPanel, els.printSizeButton);
  els.calibrationPanel.classList.toggle('hidden', !opening);
  els.calibrationButton.setAttribute('aria-expanded', String(opening));
});
els.scaleRange.addEventListener('input', (event) => {
  pxPerMm = Number(event.target.value);
  calibrated = false;
  updateScale();
});
$('#scaleDown').addEventListener('click', () => { pxPerMm = Math.max(1.5, +(pxPerMm - .05).toFixed(2)); calibrated = false; updateScale(); });
$('#scaleUp').addEventListener('click', () => { pxPerMm = Math.min(9, +(pxPerMm + .05).toFixed(2)); calibrated = false; updateScale(); });
$('#saveCalibration').addEventListener('click', () => {
  localStorage.setItem(CALIBRATION_KEY, JSON.stringify({ value: pxPerMm, screen: screenSignature() }));
  savedCalibration = { value: pxPerMm, screen: screenSignature() };
  calibrated = true;
  closePanel(els.calibrationPanel, els.calibrationButton);
  updateScale();
  showToast('Schermo calibrato. La misura 1:1 è pronta.');
});
$('#zoomOut').addEventListener('click', () => { zoom = Math.max(.25, Math.round((zoom - .25) * 100) / 100); updateScale(); });
$('#zoomIn').addEventListener('click', () => { zoom = Math.min(3, Math.round((zoom + .25) * 100) / 100); updateScale(); });
$('#actualSize').addEventListener('click', () => { zoom = 1; updateScale(); });
function updateScreenInfo() {
  els.screenInfo.textContent = `Schermo rilevato: ${screen.width} × ${screen.height} pixel · densità ${devicePixelRatio.toFixed(1)}×`;
}
updateScreenInfo();
window.addEventListener('resize', () => {
  if (calibrated && savedCalibration?.screen !== screenSignature()) {
    calibrated = false;
    pxPerMm = CSS_PX_PER_MM;
    updateScale();
  }
  updateScreenInfo();
});
updateScale();
