
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

  function extrair(linha) {
    return lista(linha.c).map((celula) => {
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
    });
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
// Posições das colunas começam em 1.
// ==================================================

const CESTAS = {
  "HIGH END": [
    {
      id: "he600",
      nome: "High End 600",
      metaColuna: 12,
      produtos: [21, 22, 23, 24, 25, 26, 27],
    },
    {
      id: "heLN",
      nome: "High End LN",
      metaColuna: 14,
      produtos: [28, 29, 30, 31, 32, 33, 36, 37],
    },
    {
      id: "heLNZero",
      nome: "High End LN Zero",
      metaColuna: 15,
      produtos: [36, 37],
    },
  ],

  CORE: [
    {
      id: "core600",
      nome: "Core 600",
      metaColuna: 17,
      produtos: [38, 39, 40, 41, 42, 43, 44, 45, 46],
    },
    {
      id: "coreRGB",
      nome: "Core RGB",
      metaColuna: 19,
      produtos: Array.from(
        { length: 21 },
        (_, i) => 38 + i
      ),
    },
  ],
};

// Validação para evitar que alterações na
// estrutura dos relatórios gerem cálculos incorretos.
const COLUNAS_ESPERADAS = {
  12: "600",
  14: "LN",
  15: "LN ZERO",
  17: "INTEIRA",
  19: "RGB",
  21: "SPT 600",
  22: "STL 600",
  23: "STL PG 600",
  24: "BUD 600",
  25: "COR 600",
  26: "ORI 600",
  27: "OUTROS 600",
  28: "COR LN",
  29: "STL LN",
  30: "STL PG LN",
  31: "SPT LN",
  32: "MIC LN",
  33: "OUTROS LN",
  34: "BUD LN",
  35: "BUD LN ZERO",
  36: "COR LN ZERO",
  37: "OUTROS LN ZERO",
  38: "AP 600",
  39: "BC 600",
  40: "BUD 600",
  41: "ORI 600",
  42: "SK 600",
  43: "SPT 600",
  44: "STL 600",
  45: "STL PG 600",
  46: "OUTROS 600",
  47: "AP 300",
  48: "BC 300",
  49: "BUD 300",
  50: "ORI 300",
  51: "SK 300",
  52: "OUTROS 300",
  53: "AP 1000",
  54: "BC 1000",
  55: "BUD 1000",
  56: "ORI 1000",
  57: "SK 1000",
  58: "OUTROS 1000",
};

function validarColunas(cabecalhos) {
  for (const [posicao, esperado] of Object.entries(
    COLUNAS_ESPERADAS
  )) {
    const encontrado = cabecalhos[Number(posicao) - 1];

    if (normalizar(encontrado) !== esperado) {
      throw new Error(
        `Coluna ${posicao}: esperado "${esperado}", ` +
        `encontrado "${encontrado}"`
      );
    }
  }
}

// ==================================================
// 3. CÁLCULO DO PORTFÓLIO IDEAL
// ==================================================

function calcularCesta(registro, cabecalhos, config) {
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

async function executar() {
  console.log("\n=== SCORE 5 - PROCESSAMENTO ===\n");

  const score = await lerExcel("fScore202610.xlsx");
  const portfolio = await lerExcel(
    "fPortifolioIdeal202610.xlsx"
  );

  validarColunas(portfolio.cabecalhos);

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

    const configuracoes = CESTAS[p.base];

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
        config
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
