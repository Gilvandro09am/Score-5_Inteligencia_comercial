// ==================================================
// GRADE DE ESTOQUE
// Liga as categorias do Portfólio Ideal (ex.: "STL 600")
// aos produtos reais da grade de estoque de cada unidade.
// ==================================================

import fs from "node:fs/promises";
import path from "node:path";

/**
 * Unidades com estoque integrado.
 * "codigo" é o prefixo da CHAVE PDV (ex.: 747530_10936 → 747530).
 * Para integrar uma nova unidade, basta adicionar uma linha aqui
 * e colocar o CSV em dados/entrada.
 */
export const UNIDADES_ESTOQUE = [
  { codigo: "747530", nome: "Patos", arquivo: "Grade de Estoque_Patos.csv" },
  { codigo: "747548", nome: "Sumé", arquivo: "Grade de Estoque_Sumé.csv" },
];

/**
 * Categoria do portfólio → regra para encontrar o produto na grade.
 * "inclui": todos os padrões precisam aparecer na descrição.
 * "exclui": nenhum desses pode aparecer.
 *
 * Categorias "OUTROS ..." não têm regra: não é possível saber
 * com segurança qual produto representa "outros", então o sistema
 * não sugere essas categorias quando o estoque está integrado.
 */
const ZERO = /\bZERO\b|\bCERO\b/;
const PURE_GOLD = /PURE GOLD/;
const LONG_NECK = /\bLN\b|LONG NECK/;
const SEISCENTOS = /\b600 ?ML\b/;
const LITRO = /\b1L\b|\b1 L\b|\b1000 ?ML\b/;
const TREZENTOS = /\b300 ?ML\b/;

export const MAPA_CATEGORIAS = {
  // ---------- 600 ml ----------
  "SPT 600": { inclui: [/^SPATEN\b/, SEISCENTOS], exclui: [ZERO] },
  "STL 600": { inclui: [/^STELLA ARTOIS\b/, SEISCENTOS], exclui: [PURE_GOLD, ZERO] },
  "STL PG 600": { inclui: [/^STELLA ARTOIS PURE GOLD\b/, SEISCENTOS] },
  "BUD 600": { inclui: [/^BUDWEISER\b/, SEISCENTOS], exclui: [ZERO] },
  "COR 600": { inclui: [/^CORONA EXTRA\b/, SEISCENTOS] },
  "ORI 600": { inclui: [/^ORIGINAL\b/, SEISCENTOS] },
  "AP 600": { inclui: [/^ANTARCTICA PILSEN\b/, SEISCENTOS] },
  "BC 600": { inclui: [/^BRAHMA CHOPP\b/, SEISCENTOS], exclui: [ZERO] },
  "SK 600": { inclui: [/^SKOL\b/, SEISCENTOS], exclui: [ZERO, /BEATS/] },

  // ---------- Long neck ----------
  "COR LN": { inclui: [/^CORONA EXTRA\b/, LONG_NECK] },
  "STL LN": { inclui: [/^STELLA ARTOIS\b/, LONG_NECK], exclui: [PURE_GOLD, ZERO] },
  "STL PG LN": { inclui: [/^STELLA ARTOIS PURE GOLD\b/, LONG_NECK] },
  "SPT LN": { inclui: [/^SPATEN\b/, LONG_NECK], exclui: [ZERO] },
  "MIC LN": { inclui: [/^MICHELOB ULTRA\b/, LONG_NECK] },
  "BUD LN": { inclui: [/^BUDWEISER\b/, LONG_NECK], exclui: [ZERO] },
  "BUD LN ZERO": { inclui: [/^BUDWEISER ZERO\b/, LONG_NECK] },
  "COR LN ZERO": { inclui: [/^CORONA CERO\b/, LONG_NECK] },

  // ---------- 300 ml (litrinho) ----------
  "AP 300": { inclui: [/^ANTARCTICA PILSEN\b/, TREZENTOS] },
  "BC 300": { inclui: [/^BRAHMA CHOPP\b/, TREZENTOS], exclui: [ZERO] },
  "BUD 300": { inclui: [/^BUDWEISER\b/, TREZENTOS], exclui: [ZERO] },
  "ORI 300": { inclui: [/^ORIGINAL\b/, TREZENTOS] },
  "SK 300": { inclui: [/^SKOL\b/, TREZENTOS], exclui: [ZERO, /BEATS/] },

  // ---------- 1 litro ----------
  "AP 1000": { inclui: [/^ANTARCTICA PILSEN\b/, LITRO] },
  "BC 1000": { inclui: [/^BRAHMA CHOPP\b/, LITRO], exclui: [ZERO] },
  "BUD 1000": { inclui: [/^BUDWEISER\b/, LITRO], exclui: [ZERO] },
  "ORI 1000": { inclui: [/^ORIGINAL\b/, LITRO] },
  "SK 1000": { inclui: [/^SKOL\b/, LITRO], exclui: [ZERO, /BEATS/] },
};

function numeroBR(valor) {
  const n = Number(String(valor ?? "").trim().replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

async function lerGrade(caminho) {
  const conteudo = (await fs.readFile(caminho, "utf8")).replace(/^﻿/, "");
  const linhas = conteudo.split(/\r?\n/).filter((l) => l.trim());
  const cabecalho = linhas[0].split(";").map((c) => c.trim());

  const idx = (nome) => {
    const i = cabecalho.indexOf(nome);
    if (i < 0) throw new Error(`Coluna "${nome}" ausente em ${path.basename(caminho)}`);
    return i;
  };

  const iCodigo = idx("CodigoProduto");
  const iDescricao = idx("DescricaoProduto");
  const iUnidade = idx("UnidadeMedida");
  const iSaldo = idx("SaldoDisponivel");

  return linhas.slice(1).map((linha) => {
    const v = linha.split(";");
    return {
      codigo: v[iCodigo]?.trim(),
      descricao: (v[iDescricao] ?? "").trim().toUpperCase().replace(/\s+/g, " "),
      unidade: (v[iUnidade] ?? "").trim(),
      saldo: numeroBR(v[iSaldo]),
    };
  });
}

function casa(regra, descricao) {
  return (
    regra.inclui.every((re) => re.test(descricao)) &&
    !(regra.exclui ?? []).some((re) => re.test(descricao))
  );
}

/**
 * Lê as grades configuradas e devolve um Map:
 * codigoUnidade → { nome, porCategoria: Map(categoria → { saldo, itens[] }) }
 */
export async function carregarEstoques(pastaEntrada) {
  const estoques = new Map();

  for (const unidade of UNIDADES_ESTOQUE) {
    const caminho = path.join(pastaEntrada, unidade.arquivo);
    let grade;
    try {
      grade = await lerGrade(caminho);
    } catch (erro) {
      if (erro.code === "ENOENT") {
        console.warn(`Estoque ${unidade.nome}: arquivo não encontrado (${unidade.arquivo}) — ignorado.`);
        continue;
      }
      throw erro;
    }

    const porCategoria = new Map();
    for (const [categoria, regra] of Object.entries(MAPA_CATEGORIAS)) {
      const itens = grade
        .filter((p) => casa(regra, p.descricao))
        .sort((a, b) => b.saldo - a.saldo);
      porCategoria.set(categoria, {
        saldo: itens.reduce((t, p) => t + Math.max(0, p.saldo), 0),
        itens,
      });
    }

    estoques.set(unidade.codigo, { nome: unidade.nome, porCategoria });

    console.log(`\nEstoque ${unidade.nome} (${unidade.codigo}): ${grade.length} produtos na grade`);
    console.table(
      Object.fromEntries(
        [...porCategoria].map(([cat, e]) => [
          cat,
          {
            saldo: e.saldo,
            produtos: e.itens.map((i) => `${i.descricao} (${i.saldo})`).join(" | ") || "—",
          },
        ])
      )
    );
  }

  return estoques;
}

/** Status de estoque de uma categoria para um PDV. */
export function estoqueDaCategoria(estoque, categoria) {
  if (!estoque) return null; // unidade sem estoque integrado

  const info = estoque.porCategoria.get(categoria);
  if (!info) {
    return { status: "NAO_MAPEADO", saldo: 0, itens: [] };
  }

  const itens = info.itens
    .filter((i) => i.saldo > 0)
    .map((i) => ({ codigo: i.codigo, descricao: i.descricao, unidade: i.unidade, saldo: i.saldo }));

  return {
    status: info.saldo > 0 ? "DISPONIVEL" : "SEM_ESTOQUE",
    saldo: info.saldo,
    itens,
  };
}
