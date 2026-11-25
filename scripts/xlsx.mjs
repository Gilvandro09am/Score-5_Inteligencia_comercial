// Leitor leve de XLSX (regex sobre o XML): aguenta os exports grandes do BEES Force,
// aceita prefixos de namespace (<x:row>) e células sem referência (r="A1").

import JSZip from "jszip";
import fs from "node:fs/promises";
import path from "node:path";

function decodificar(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

function textosDe(xml) {
  let out = "";
  for (const m of xml.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)) out += m[1];
  return decodificar(out);
}

function indiceColuna(letras) {
  let n = 0;
  for (const l of letras) n = n * 26 + (l.charCodeAt(0) - 64);
  return n - 1;
}

export async function lerPlanilha(arquivo) {
  const zip = await JSZip.loadAsync(await fs.readFile(arquivo));

  const strings = [];
  const shared = zip.file("xl/sharedStrings.xml");
  if (shared) {
    const xml = await shared.async("string");
    for (const m of xml.matchAll(/<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g)) strings.push(textosDe(m[1]));
  }

  const abas = zip.file(/^xl\/worksheets\/sheet\d+\.xml$/);
  if (!abas.length) throw new Error(`Nenhuma aba em ${path.basename(arquivo)}`);
  const xml = await abas.sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }))[0].async("string");

  const linhas = [];
  // Aceita tags com prefixo de namespace (<x:row>) e células sem referência (r="A1")
  const reLinha = /<(?:\w+:)?row(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?row>/g;
  const reCelula = /<(?:\w+:)?c(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;
  for (const row of xml.matchAll(reLinha)) {
    const valores = [];
    for (const c of row[1].matchAll(reCelula)) {
      const [, attrs = "", corpo = ""] = c;
      const col = attrs.match(/\br="([A-Z]+)\d+"/)?.[1];
      const tipo = attrs.match(/\bt="([^"]+)"/)?.[1];
      let v = "";
      if (tipo === "inlineStr") v = textosDe(corpo);
      else {
        const bruto = corpo.match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1] ?? "";
        v = tipo === "s" ? strings[Number(bruto)] ?? "" : decodificar(bruto);
      }
      valores[col ? indiceColuna(col) : valores.length] = v.trim();
    }
    linhas.push(Array.from(valores, (x) => x ?? ""));
  }

  const [cab, ...resto] = linhas;
  return resto.map((l) => Object.fromEntries(cab.map((k, i) => [k, l[i] ?? ""])));
}
