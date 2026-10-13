/**
 * SANDÍA — Formularios de alta de clientes.
 *
 * Crea un Google Form por vertical (hotel, clínica, comercio) a partir de
 * las preguntas que define SANDÍA (src/lib/onboarding/spec.ts), y manda
 * cada respuesta de vuelta a SANDÍA. Instrucciones en README.md.
 *
 * Funciones para ejecutar a mano:
 *   crearFormularios()   — crea los que falten y los registra en SANDÍA.
 *   recrearFormularios() — crea formularios nuevos con las preguntas
 *                          actuales (los enlaces se regeneran en /admin).
 *   reenviarRespuestas() — vuelve a mandar todas las respuestas a SANDÍA.
 */

const SANDIA_URL = 'https://chatsandia.com';
const TOKEN_PLACEHOLDER = 'TOKEN_SANDIA';

function secreto_() {
  const s = PropertiesService.getScriptProperties().getProperty('SANDIA_SECRET');
  if (!s) throw new Error('Falta la propiedad SANDIA_SECRET (cópiala de /admin → Formularios de alta).');
  return s;
}

function post_(path, body) {
  const res = UrlFetchApp.fetch(SANDIA_URL + path, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-onboarding-secret': secreto_() },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) {
    throw new Error(path + ' respondió ' + res.getResponseCode() + ': ' + res.getContentText());
  }
}

function crearFormularios() {
  secreto_();
  const spec = JSON.parse(UrlFetchApp.fetch(SANDIA_URL + '/api/onboarding/form-spec').getContentText());
  const props = PropertiesService.getScriptProperties();
  spec.forms.forEach(function (f) {
    const key = 'form_' + f.vertical;
    let form = props.getProperty(key) ? FormApp.openById(props.getProperty(key)) : null;
    if (!form) {
      form = construir_(f);
      props.setProperty(key, form.getId());
      props.setProperty('vertical_' + form.getId(), f.vertical);
    }
    instalarTrigger_(form);
    const codeItem = form.getItems(FormApp.ItemType.TEXT).filter(function (i) {
      return i.getTitle() === f.codeTitle;
    })[0];
    const prefill = form.createResponse()
      .withItemResponse(codeItem.asTextItem().createResponse(TOKEN_PLACEHOLDER))
      .toPrefilledUrl();
    post_('/api/onboarding/forms', { form_vertical: f.vertical, prefill_url: prefill, edit_url: form.getEditUrl() });
    console.log(f.vertical + ': ' + form.getEditUrl());
  });
}

function recrearFormularios() {
  const props = PropertiesService.getScriptProperties();
  ['hotel', 'clinica', 'comercio'].forEach(function (v) { props.deleteProperty('form_' + v); });
  crearFormularios();
}

function construir_(f) {
  const form = FormApp.create(f.title);
  form.setDescription(f.description);
  form.setConfirmationMessage('¡Gracias! Recibimos tu información. Tu asesor de SANDÍA te escribe cuando tu asistente esté listo.');
  form.setAllowResponseEdits(false);
  form.addTextItem().setTitle(f.codeTitle).setHelpText('Viene lleno en tu enlace. No lo cambies.').setRequired(true);
  f.sections.forEach(function (s) {
    const page = form.addPageBreakItem().setTitle(s.title);
    if (s.description) page.setHelpText(s.description);
    s.questions.forEach(function (q) {
      let item;
      if (q.type === 'text') item = form.addTextItem();
      else if (q.type === 'paragraph') item = form.addParagraphTextItem();
      else if (q.type === 'choice') item = form.addMultipleChoiceItem().setChoiceValues(q.options);
      else if (q.type === 'checkbox') item = form.addCheckboxItem().setChoiceValues(q.options);
      else item = form.addListItem().setChoiceValues(q.options); // 'hour'
      item.setTitle(q.title).setRequired(q.required);
      if (q.help) item.setHelpText(q.help);
    });
  });
  // Copia de respaldo de las respuestas en una hoja de cálculo.
  const sheet = SpreadsheetApp.create(f.title + ' (respuestas)');
  form.setDestination(FormApp.DestinationType.SPREADSHEET, sheet.getId());
  return form;
}

function instalarTrigger_(form) {
  const exists = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getTriggerSourceId() === form.getId() && t.getHandlerFunction() === 'enviarRespuesta';
  });
  if (!exists) ScriptApp.newTrigger('enviarRespuesta').forForm(form).onFormSubmit().create();
}

/** Trigger: cada respuesta nueva se manda a SANDÍA. */
function enviarRespuesta(e) {
  enviar_(e.response);
}

function enviar_(response) {
  const answers = {};
  let token = '';
  response.getItemResponses().forEach(function (ir) {
    const title = ir.getItem().getTitle();
    if (title === 'Código de alta') token = String(ir.getResponse()).trim();
    else answers[title] = ir.getResponse();
  });
  post_('/api/onboarding/intake', { token: token, answers: answers });
}

function reenviarRespuestas() {
  const props = PropertiesService.getScriptProperties();
  ['hotel', 'clinica', 'comercio'].forEach(function (v) {
    const id = props.getProperty('form_' + v);
    if (!id) return;
    FormApp.openById(id).getResponses().forEach(function (r) {
      try { enviar_(r); } catch (err) { console.log(v + ': ' + err.message); }
    });
  });
}
