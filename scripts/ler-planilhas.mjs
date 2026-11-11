
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { carregarEstoques, estoqueDaCategoria } from "./estoque.mjs";

const raiz = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

const entrada = path.join(raiz, "dados", "entrada");
const saida = path.join(raiz, "dados", "processados");

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
});

function lista(valor) {
  if (valor == null) return [];
  return Array.isArray(valor) ? valor : [valor];
}

function texto(valor) {
  if (valor == null) return "";

  if (typeof valor === "object") {
    return texto(valor["#text"] ?? "");
  }

  return String(valor).trim();
}

function numero(valor) {
  const valorTexto = texto(valor);

  if (!valorTexto) return null;

  const n = Number(valorTexto.replace(",", "."));

  return Number.isFinite(n) ? n : null;
}

function normalizar(valor) {
  return texto(valor).toUpperCase().replace(/\s+/g, " ");
}

// ==================================================
// 1. LEITURA DOS RELATÓRIOS EXCEL
// ==================================================

async function lerExcel(nomeArquivo) {
  console.log("Lendo:", nomeArquivo);

  const buffer = await fs.readFile(
    path.join(entrada, nomeArquivo)
  );

  const zip = await JSZip.loadAsync(buffer);
  const aba = zip.file("xl/worksheets/sheet1.xml");

  if (!aba) {
    throw new Error(`Aba não encontrada: ${nomeArquivo}`);
  }

  let strings = [];
  const shared = zip.file("xl/sharedStrings.xml");

  if (shared) {
    const xml = parser.parse(await shared.async("string"));

    strings = lista(xml.sst?.si).map((item) => {
      if (item.t !== undefined) return texto(item.t);

      return lista(item.r)
        .map((parte) => texto(parte.t))
        .join("");
    });
  }

  const documento = parser.parse(await aba.async("string"));
  const linhas = lista(documento.worksheet?.sheetData?.row);

  // Converte a referência da célula ("AB12") no índice da coluna (base 0).
  // Necessário porque o Excel omite células vazias em algumas planilhas.
  function indiceColuna(referencia) {
    const letras = String(referencia ?? "").match(/^[A-Z]+/)?.[0];
    if (!letras) return null;
    let n = 0;
    for (const letra of letras) n = n * 26 + (letra.charCodeAt(0) - 64);
    return n - 1;
  }

  function valorCelula(celula) {
    const tipo = celula["@_t"];

    if (tipo === "inlineStr") {
      if (celula.is?.t !== undefined) {
        return texto(celula.is.t);
      }

      return lista(celula.is?.r)
        .map((parte) => texto(parte.t))
        .join("");
    }

    if (tipo === "s") {
      return strings[Number(celula.v)] ?? "";
    }

    return texto(celula.v);
  }

  function extrair(linha) {
    const valores = [];
    for (const celula of lista(linha.c)) {
      const indice = indiceColuna(celula["@_r"]) ?? valores.length;
      valores[indice] = valorCelula(celula);
    }
    return Array.from(valores, (v) => v ?? "");
  }

  if (!linhas.length) {
    throw new Error(`Planilha vazia: ${nomeArquivo}`);
  }

  const cabecalhos = extrair(linhas[0]);

  const obrigatorias = [
    "id_ano_mes",
    "CHAVE PDV",
    "NOME PDV",
    "OPERAÇÃO",
    "GV",
    "RN",
    "BASE",
    "VISITA",
  ];

  for (const coluna of obrigatorias) {
    if (!cabecalhos.includes(coluna)) {
      throw new Error(
        `Coluna obrigatória ausente: ${coluna} (${nomeArquivo})`
      );
    }
  }

  const registros = [];

  for (const linhaXML of linhas.slice(1)) {
    const valores = extrair(linhaXML);

    const obter = (nome) => {
      const indice = cabecalhos.indexOf(nome);
      return indice < 0 ? "" : valores[indice] ?? "";
    };

    const competencia = obter("id_ano_mes");
    const pdv = obter("CHAVE PDV");

    if (!competencia || !pdv) continue;

    registros.push({
      chave: `${competencia}|${pdv}`,
      competencia,
      pdv,
      nome: obter("NOME PDV"),
      operacao: obter("OPERAÇÃO"),
      gv: obter("GV"),
      rn: obter("RN"),
      base: normalizar(obter("BASE")),
      visita: obter("VISITA"),
      linha: valores,
      obter,
    });
  }

  console.log(
    `${nomeArquivo}: ${registros.length} registros encontrados`
  );

  return { cabecalhos, registros };
}

// ==================================================
// 2. CONFIGURAÇÃO DAS CESTAS
// As colunas são localizadas pelo NOME do cabeçalho, não pela posição.
// Em nov/2026 a coluna vazia "STL PG 600" (meta) saiu do relatório e
// todas as posições mudaram — por isso não usamos mais números fixos.
//
// "bloco" indica em qual trecho da planilha procurar o produto, pois
// alguns nomes se repetem (ex.: "BUD 600" existe no High End e no Core).
// ==================================================

const CESTAS = {
  "HIGH END": [
    {
      id: "he600",
      nome: "High End 600",
      meta: "600",
      bloco: "HIGH_END",
      produtos: ["SPT 600", "STL 600", "STL PG 600", "BUD 600", "COR 600", "ORI 600", "OUTROS 600"],
    },
    {
      id: "heLN",
      nome: "High End LN",
      meta: "LN",
      bloco: "HIGH_END",
      produtos: ["COR LN", "STL LN", "STL PG LN", "SPT LN", "MIC LN", "OUTROS LN", "COR LN ZERO", "OUTROS LN ZERO"],
    },
    {
      id: "heLNZero",
      nome: "High End LN Zero",
      meta: "LN ZERO",
      bloco: "HIGH_END",
      produtos: ["COR LN ZERO", "OUTROS LN ZERO"],
    },
  ],

  CORE: [
    {
      id: "core600",
      nome: "Core 600",
      meta: "INTEIRA",
      bloco: "CORE",
      produtos: ["AP 600", "BC 600", "BUD 600", "ORI 600", "SK 600", "SPT 600", "STL 600", "STL PG 600", "OUTROS 600"],
    },
    {
      id: "coreRGB",
      nome: "Core RGB",
      meta: "RGB",
      bloco: "CORE",
      produtos: [
        "AP 600", "BC 600", "BUD 600", "ORI 600", "SK 600", "SPT 600", "STL 600", "STL PG 600", "OUTROS 600",
        "AP 300", "BC 300", "BUD 300", "ORI 300", "SK 300", "OUTROS 300",
        "AP 1000", "BC 1000", "BUD 1000", "ORI 1000", "SK 1000", "OUTROS 1000",
      ],
    },
  ],
};

/**
 * Converte a configuração por nome em posições de coluna (base 1)
 * para o layout da planilha deste mês. Falha com mensagem clara se
 * algum cabeçalho esperado não existir.
 */
function resolverCestas(cabecalhos) {
  const nomes = cabecalhos.map(normalizar);

  const achar = (nome, inicio = 0, fim = nomes.length) => {
    const i = nomes.indexOf(nome, inicio);
    if (i < 0 || i >= fim) {
      throw new Error(`Coluna "${nome}" não encontrada no Portfólio Ideal.`);
    }
    return i;
  };

  // O bloco Core começa em "AP 600"; o High End fica entre a meta RGB e ele.
  const inicioCore = achar("AP 600");
  const inicioHighEnd = achar("RGB") + 1;
  const blocos = {
    HIGH_END: [inicioHighEnd, inicioCore],
    CORE: [inicioCore, nomes.length],
  };

  const resolvidas = {};
  for (const [base, configs] of Object.entries(CESTAS)) {
    resolvidas[base] = configs.map((config) => {
      const [ini, fim] = blocos[config.bloco];
      return {
        id: config.id,
        nome: config.nome,
        metaColuna: achar(config.meta, 0, inicioHighEnd) + 1,
        produtos: config.produtos.map((p) => achar(p, ini, fim) + 1),
      };
    });
  }

  console.log("\nColunas localizadas no Portfólio Ideal:");
  console.table(
    Object.fromEntries(
      Object.values(resolvidas).flat().map((c) => [
        c.nome,
        { meta: `${c.metaColuna}:${nomes[c.metaColuna - 1]}`, produtos: c.produtos.join(",") },
      ])
    )
  );

  return resolvidas;
}

// ==================================================
// 3. CÁLCULO DO PORTFÓLIO IDEAL
// ==================================================

function calcularCesta(registro, cabecalhos, config, estoque) {
  const metaOriginal = numero(
    registro.linha[config.metaColuna - 1]
  );

  const possuiMeta = metaOriginal !== null &&
    metaOriginal > 0;

  const produtos = config.produtos.map((coluna) => {
    const nome = normalizar(cabecalhos[coluna - 1]);

    // Campo vazio equivale a zero SKUs realizados.
    const realizado = numero(
      registro.linha[coluna - 1]
    ) ?? 0;

    if (realizado < 0) {
      throw new Error(
        `Realizado negativo: ${registro.pdv}, ${nome}`
      );
    }

    return {
      nome,
      coluna,
      realizado,
      comprado: realizado > 0,
      // null = unidade sem estoque integrado
      estoque: estoqueDaCategoria(estoque, nome),
    };
  });

  // Cada unidade contabilizada representa
  // um SKU distinto, incluindo versões One Way.
  const realizado = produtos.reduce(
    (total, produto) => total + produto.realizado,
    0
  );

  const meta = possuiMeta ? metaOriginal : null;

  const faltam = possuiMeta
    ? Math.max(0, meta - realizado)
    : null;

  const atingimento = possuiMeta
    ? Math.round((realizado / meta) * 1000) / 10
    : null;

  const status = !possuiMeta
    ? "SEM_META"
    : faltam === 0
      ? "CONCLUIDA"
      : "PENDENTE";

  // Categorias ainda não compradas.
  const oportunidades = possuiMeta && faltam > 0
    ? produtos
        .filter((produto) => produto.realizado === 0)
        .map((produto) => produto.nome)
    : [];

  // Categorias com uma única versão realizada.
  const oportunidadesOneWay = possuiMeta && faltam > 0
    ? produtos
        .filter((produto) => produto.realizado === 1)
        .map((produto) => produto.nome)
    : [];

  return {
    id: config.id,
    nome: config.nome,
    meta,
    realizado,
    faltam,
    atingimento,
    status,
    produtos,
    oportunidades,
    oportunidadesOneWay,
  };
}

// ==================================================
// 4. CÁLCULO DO FATURAMENTO
// ==================================================

function calcularFaturamento(registro) {
  const metaOriginal = numero(
    registro.obter("META TASK")
  );

  const realizadoOriginal = numero(
    registro.obter("REAL TASK")
  );

  const possuiTask = normalizar(
    registro.obter("POSSUI TASK")
  );

  const possuiMeta = metaOriginal !== null &&
    metaOriginal > 0;

  const meta = possuiMeta ? metaOriginal : null;
  const realizado = realizadoOriginal ?? 0;

  const faltam = possuiMeta
    ? Math.max(0, meta - realizado)
    : null;

  const atingimento = possuiMeta
    ? Math.round((realizado / meta) * 1000) / 10
    : null;

  const status = !possuiMeta
    ? "SEM_META"
    : faltam === 0
      ? "CONCLUIDA"
      : "PENDENTE";

  return {
    meta,
    realizado,
    faltam,
    atingimento,
    possuiTask,
    status,
  };
}

// ==================================================
// 5. RELACIONAMENTO ENTRE AS PLANILHAS
// ==================================================

function criarMapa(registros, nome) {
  const mapa = new Map();
  const duplicados = new Set();

  for (const registro of registros) {
    if (mapa.has(registro.chave)) {
      duplicados.add(registro.chave);
    }

    mapa.set(registro.chave, registro);
  }

  for (const chave of duplicados) {
    mapa.delete(chave);
  }

  console.log(
    `${nome}: ${duplicados.size} chaves duplicadas`
  );

  return mapa;
}

function montarRecomendacoes(cliente) {
  const recomendacoes = [];

  if (cliente.faturamento.status === "PENDENTE") {
    recomendacoes.push({
      tipo: "FATURAMENTO",
      mensagem:
        `Faltam R$ ${cliente.faturamento.faltam
          .toLocaleString("pt-BR", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })} para atingir a meta de faturamento.`,
    });
  }

  for (const cesta of cliente.cestas) {
    if (cesta.status !== "PENDENTE") continue;

    recomendacoes.push({
      tipo: "PORTFOLIO",
      cesta: cesta.nome,
      mensagem:
        `Faltam ${cesta.faltam} SKUs distintos ` +
        `para concluir ${cesta.nome}.`,
      categoriasNaoCompradas: cesta.oportunidades,
      categoriasComUmaVersao: cesta.oportunidadesOneWay,
    });
  }

  return recomendacoes;
}

// ==================================================
// 6. PROCESSAMENTO PRINCIPAL
// ==================================================

/**
 * Competência a processar:
 *   node scripts/ler-planilhas.mjs 202611  → usa o mês informado
 *   node scripts/ler-planilhas.mjs         → usa o mês mais recente
 *                                             que tenha as duas planilhas
 */
async function escolherCompetencia() {
  const informada = process.argv[2];
  if (informada) {
    if (!/^\d{6}$/.test(informada)) {
      throw new Error(`Competência inválida: "${informada}". Use AAAAMM, ex.: 202611.`);
    }
    return informada;
  }

  const arquivos = await fs.readdir(entrada);
  const meses = (prefixo) =>
    new Set(
      arquivos
        .map((a) => (a.startsWith(prefixo) ? a.slice(prefixo.length).match(/^(\d{6})\.xlsx$/)?.[1] : null))
        .filter(Boolean)
    );
  const score = meses("fScore");
  const disponiveis = [...meses("fPortifolioIdeal")].filter((m) => score.has(m)).sort();

  if (!disponiveis.length) {
    throw new Error("Nenhum par fScoreAAAAMM.xlsx + fPortifolioIdealAAAAMM.xlsx em dados/entrada.");
  }
  return disponiveis.at(-1);
}

async function executar() {
  console.log("\n=== SCORE 5 - PROCESSAMENTO ===\n");

  const competencia = await escolherCompetencia();
  console.log(`Competência: ${competencia}
`);

  const score = await lerExcel(`fScore${competencia}.xlsx`);
  const portfolio = await lerExcel(
    `fPortifolioIdeal${competencia}.xlsx`
  );

  const CESTAS_MES = resolverCestas(portfolio.cabecalhos);
  const estoques = await carregarEstoques(entrada);

  const mapaScore = criarMapa(
    score.registros,
    "Faturamento"
  );

  const mapaPortfolio = criarMapa(
    portfolio.registros,
    "Portfólio"
  );

  const clientes = [];

  for (const [chave, s] of mapaScore) {
    const p = mapaPortfolio.get(chave);

    if (!p) continue;

    const configuracoes = CESTAS_MES[p.base];

    // O prefixo da CHAVE PDV é o código da unidade (ex.: 747530_10936).
    const codigoUnidade = p.pdv.split("_")[0];
    const estoque = estoques.get(codigoUnidade);

    if (!configuracoes) {
      throw new Error(
        `Classificação desconhecida no PDV ${p.pdv}: ${p.base}`
      );
    }

    if (s.base !== p.base) {
      throw new Error(
        `Classificação divergente no PDV ${p.pdv}`
      );
    }

    const cestas = configuracoes.map((config) =>
      calcularCesta(
        p,
        portfolio.cabecalhos,
        config,
        estoque
      )
    );

    const cliente = {
      chave,
      competencia: s.competencia,

      // Identificação do PDV
      pdv: s.pdv,
      nome: p.nome || s.nome,
      nomeFantasia: p.nome || s.nome,
      visita: p.visita || s.visita || "Indefinido",

      // Estrutura comercial
      base: p.base,
      operacao: s.operacao,
      gv: s.gv,
      rn: s.rn,
      codigoUnidade,
      // Nome da unidade quando o estoque está integrado (ex.: "Patos", "Sumé")
      unidadeEstoque: estoque?.nome ?? null,

      // Resultados comerciais
      faturamento: calcularFaturamento(s),
      cestas,

      // Resumo
      cestasComMeta: cestas.filter(
        (c) => c.meta !== null
      ).length,

      cestasPendentes: cestas.filter(
        (c) => c.status === "PENDENTE"
      ).length,

      cestasConcluidas: cestas.filter(
        (c) => c.status === "CONCLUIDA"
      ).length,

      skusFaltantes: cestas.reduce(
        (total, c) => total + (c.faltam ?? 0),
        0
      ),
    };

    cliente.recomendacoes = montarRecomendacoes(
      cliente
    );

    clientes.push(cliente);
  }

  // Organização da lista por operação,
  // GV, RN e nome fantasia.
  clientes.sort((a, b) => {
    return (
      a.operacao.localeCompare(b.operacao, "pt-BR") ||
      a.gv.localeCompare(b.gv, "pt-BR", {
        numeric: true,
      }) ||
      a.rn.localeCompare(b.rn, "pt-BR", {
        numeric: true,
      }) ||
      a.nomeFantasia.localeCompare(
        b.nomeFantasia,
        "pt-BR"
      )
    );
  });

  // ==================================================
  // 7. GERAR BASE CONSOLIDADA
  // ==================================================

  await fs.mkdir(saida, { recursive: true });

  const destino = path.join(
    saida,
    "clientes-score5.json"
  );

  await fs.writeFile(
    destino,
    JSON.stringify(clientes, null, 2),
    "utf8"
  );

  // ==================================================
  // 8. RELATÓRIO DE CONFERÊNCIA
  // ==================================================

  console.log("\n=== RESULTADO GERAL ===");

  console.log(
    "Registros fScore:",
    score.registros.length
  );

  console.log(
    "Registros Portfólio:",
    portfolio.registros.length
  );

  console.log("PDVs consolidados:", clientes.length);

  const resumo = {};

  for (const cliente of clientes) {
    for (const cesta of cliente.cestas) {
      resumo[cesta.nome] ??= {
        semMeta: 0,
        pendentes: 0,
        concluidas: 0,
      };

      const item = resumo[cesta.nome];

      if (cesta.status === "SEM_META") item.semMeta++;
      if (cesta.status === "PENDENTE") item.pendentes++;
      if (cesta.status === "CONCLUIDA") {
        item.concluidas++;
      }
    }
  }

  console.log("\n=== RESUMO DAS CESTAS ===");
  console.table(resumo);

  console.log("\n=== EXEMPLO DE PDV ===");

  const exemplo = clientes.find(
    (cliente) => cliente.cestasPendentes > 0
  ) ?? clientes[0];

  if (exemplo) {
    console.log({
      nomeFantasia: exemplo.nomeFantasia,
      visita: exemplo.visita,
      operacao: exemplo.operacao,
      gv: exemplo.gv,
      rn: exemplo.rn,
      base: exemplo.base,
    });

    console.table(
      exemplo.cestas.map((c) => ({
        cesta: c.nome,
        meta: c.meta,
        realizado: c.realizado,
        faltam: c.faltam,
        status: c.status,
      }))
    );

    console.log(
      "Recomendações:",
      exemplo.recomendacoes
    );
  }

  console.log("\nArquivo JSON atualizado:");
  console.log(destino);

  console.log("\nPROCESSAMENTO CONCLUÍDO!");
}

executar().catch((erro) => {
  console.error("\nERRO NO PROCESSAMENTO:");
  console.error(erro.stack || erro.message);
  process.exitCode = 1;
});
