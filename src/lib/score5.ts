import fs from "node:fs/promises";
import path from "node:path";
import { connection } from "next/server";

// ==================================================
// TIPOS (espelham dados/processados/clientes-score5.json)
// ==================================================

export type StatusMeta = "CONCLUIDA" | "PENDENTE" | "SEM_META";

export type ItemEstoque = {
  codigo: string;
  descricao: string;
  unidade: string;
  saldo: number;
};

export type EstoqueCategoria = {
  /** NAO_MAPEADO = categoria "OUTROS", sem produto definido na grade */
  status: "DISPONIVEL" | "SEM_ESTOQUE" | "NAO_MAPEADO";
  saldo: number;
  /** Somente produtos com saldo > 0, do maior para o menor saldo */
  itens: ItemEstoque[];
};

export type Produto = {
  nome: string;
  coluna: number;
  realizado: number;
  comprado: boolean;
  /** null = unidade sem estoque integrado */
  estoque?: EstoqueCategoria | null;
};

export type Cesta = {
  id: string;
  nome: string;
  meta: number | null;
  realizado: number;
  faltam: number | null;
  atingimento: number | null;
  status: StatusMeta;
  confirmada?: boolean; // concluída pelo "BATEU META" = 1 do Portfólio Ideal, mesmo com SKUs abaixo da meta
  produtos: Produto[];
  oportunidades: string[];
  oportunidadesOneWay: string[];
};

export type Cliente = {
  chave: string;
  competencia: string;
  pdv: string;
  nome: string;
  nomeFantasia: string;
  visita: string;
  /** Cidade do cadastro dClientes ("Sem cidade" quando não encontrado) */
  cidade?: string;
  bairro?: string;
  base: string;
  operacao: string;
  gv: string;
  rn: string;
  codigoUnidade?: string;
  /** Nome da unidade quando o estoque está integrado (ex.: "Patos"); null caso contrário */
  unidadeEstoque?: string | null;
  faturamento: {
    meta: number | null;
    realizado: number;
    faltam: number | null;
    atingimento: number | null;
    possuiTask?: string;
    taskFatOk?: boolean; // "TASK FAT" = 1 no Score: task de faturamento validada no BEES
    realizadoRelatorio?: number | null; // REAL TASK do relatório quando a task confirmou a meta
    status: StatusMeta;
  };
  cestas: Cesta[];
  cestasComMeta: number;
  cestasPendentes: number;
  cestasConcluidas: number;
  skusFaltantes: number;
};

// Em produção (Vercel) os dados vêm do Supabase Storage (bucket privado,
// enviado por `npm run publicar`). Localmente, sem as variáveis do Supabase,
// lê o arquivo gerado por `npm run processar`.
export const SUPABASE_BUCKET = "score5";
export const SUPABASE_ARQUIVO = "clientes-score5.json";

// Cache em memória para não baixar os JSONs (~5 MB) a cada acesso.
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { dados: unknown; em: number }>();

// Lê um JSON processado: do Supabase Storage em produção, de dados/processados no local.
async function carregarJson<T>(arquivo: string): Promise<T> {
  const url = process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !chave) {
    if (process.env.VERCEL) {
      throw new Error(
        "SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY não configuradas na Vercel (Settings → Environment Variables). Depois de adicionar, faça um Redeploy."
      );
    }
    const caminho = path.join(process.cwd(), "dados", "processados", arquivo);
    return JSON.parse(await fs.readFile(caminho, "utf8")) as T;
  }

  await connection(); // dados lidos no momento do pedido (o cache usa o relógio)
  const emCache = cache.get(arquivo);
  if (emCache && Date.now() - emCache.em < CACHE_MS) return emCache.dados as T;

  const resposta = await fetch(
    `${url.replace(/\/$/, "")}/storage/v1/object/${SUPABASE_BUCKET}/${arquivo}`,
    {
      headers: { Authorization: `Bearer ${chave}`, apikey: chave },
      cache: "no-store",
    }
  );

  if (!resposta.ok) {
    throw new Error(
      `Falha ao baixar ${arquivo} do Supabase (${resposta.status}): ${await resposta.text()}`
    );
  }

  const dados = (await resposta.json()) as T;
  cache.set(arquivo, { dados, em: Date.now() });
  return dados;
}

export function carregarClientes(): Promise<Cliente[]> {
  return carregarJson<Cliente[]>(SUPABASE_ARQUIVO);
}

// ==================================================
// TAREFAS BEES (aba Oportunidades de task)
// ==================================================

export const ARQUIVO_TAREFAS = "tarefas-score5.json";

// Formato compacto gerado por scripts/ler-tarefas.mjs
type TarefasBrutas = {
  geradoEm: string;
  rotas: Record<string, string>;
  operacoes: string[];
  clusters: string[];
  cestas: string[];
  textos: string[];
  nomes?: Record<string, string>; // "unb_pdv" → nome fantasia (dClientes / Pedidos Cora / Promax)
  cidades?: Record<string, string>; // "unb_pdv" → cidade (dClientes)
  visitas?: Record<string, string>; // "unb_pdv" → dias de visita do RN (ex.: "SEG/QUI/")
  ultimas?: Record<string, string>; // "unb_pdv" → data da última visita no BEES
  // [operação, unb, pdv, setor, gv, cluster, cesta, texto, qtd solicitada, qtd já comprada, pontuação, na rota do dia, mensal]
  linhas: [
    number, string, string, string, string, number, number, number,
    number | null, number | null, (number | null)?, (0 | 1)?, (0 | 1)?,
  ][];
};

export type Tarefa = {
  operacao: string;
  unb: string;
  pdv: string;
  chave: string; // "unb_pdv", mesma chave do Score 5
  setor: string;
  gv: string;
  cidade: string;
  cluster: string;
  cesta: string;
  texto: string;
  solicitada: number | null;
  comprada: number | null;
  falta: number | null; // null = tarefa sem quantidade definida
  pontos: number; // pontuação BEES Force que a tarefa paga ao ser validada
  naRota: boolean; // tarefa da rota do dia (senão, mensal em aberto da última visita)
  mensal: boolean;
  visita: string; // dias de visita do RN, ex.: "SEG/QUI/"
  ultimaVisita: string; // "AAAA-MM-DD"
};

export type BaseTarefas = {
  geradoEm: string;
  rotas: Record<string, string>;
  cestas: string[];
  nomes: Record<string, string>;
  tarefas: Tarefa[];
};

// Tarefas em aberto (OPEN) da rota do dia. Sem o arquivo publicado, devolve vazio.
export async function carregarTarefas(): Promise<BaseTarefas> {
  let b: TarefasBrutas;
  try {
    b = await carregarJson<TarefasBrutas>(ARQUIVO_TAREFAS);
  } catch (erro) {
    console.error(erro);
    return { geradoEm: "", rotas: {}, cestas: [], nomes: {}, tarefas: [] };
  }
  return {
    geradoEm: b.geradoEm,
    rotas: b.rotas,
    cestas: b.cestas,
    nomes: b.nomes ?? {},
    tarefas: b.linhas.map(([op, unb, pdv, setor, gv, cl, ce, tx, sol, ja, pts, rota, men]) => ({
      operacao: b.operacoes[op],
      unb,
      pdv,
      chave: `${unb}_${pdv}`,
      setor,
      gv,
      cidade: b.cidades?.[`${unb}_${pdv}`] || "Sem cidade",
      cluster: b.clusters[cl],
      cesta: b.cestas[ce],
      texto: b.textos[tx],
      solicitada: sol,
      comprada: ja,
      falta: sol === null ? null : Math.max(0, sol - (ja ?? 0)),
      pontos: pts ?? 0,
      naRota: rota === undefined ? true : rota === 1,
      mensal: men === 1,
      visita: b.visitas?.[`${unb}_${pdv}`] ?? "",
      ultimaVisita: b.ultimas?.[`${unb}_${pdv}`] ?? "",
    })),
  };
}

// ==================================================
// COMPRADORES (aba Compradores — faturado 03.02.37)
// ==================================================

export const ARQUIVO_COMPRADORES = "compradores-score5.json";

// Formato compacto gerado por scripts/ler-compradores.mjs
type CompradoresBrutos = {
  geradoEm: string;
  mes: string; // "AAAA-MM"
  ultimaEmissao: string; // "AAAA-MM-DD"
  operacoes: string[];
  rns: Record<string, [string, string]>; // "op|setor" → [gv, nome do RN]
  metas?: Record<string, number>; // "op|setor" → meta de compradores do mês
  bi?: {
    atualizadoEm: string;
    mes: string;
    operacoes?: number[]; // operações que vieram no export do BI
    rn: Record<string, number>; // "op|setor" → compradores no BI
    // [op, pdv, nome, cidade, motivo, setor no acomp, setor no BI]
    divergencias: [number, string, string, string, MotivoDivergencia, string, string][];
  } | null;
  // [op, pdv, nome, cidade, setor do comprador, setor da carteira, situação, notas, valor venda, última compra]
  clientes: [number, string, string, string, string, string, 0 | 1 | 2, number, number, string, string?][];
};

export type SituacaoCompra = "venda" | "bonificacao" | "nao";

export type ClienteCompra = {
  operacao: string;
  pdv: string;
  nome: string;
  cidade: string;
  setor: string; // RN que faturou (ou o da carteira, se não comprou)
  gv: string;
  rn: string; // nome do RN
  carteira: string; // setor da carteira ativa no dClientes ("" = fora da carteira ativa)
  situacao: SituacaoCompra; // venda = comprou com venda; bonificacao = só bonificação
  notas: number;
  valor: number; // R$ das notas de venda
  ultimaCompra: string; // "DD/MM"
  visita: string; // dias de visita do RN no dClientes, ex.: "SEG/QUI/"
};

// Por que o PDV conta diferente no acomp (faturado 03.02.37) e no BI da Ambev
export type MotivoDivergencia =
  | "balcao" // comprou no balcão / sem RN: só o acomp conta
  | "setorForaBi" // comprou por um setor que o BI não tem (ex.: 12 Digital)
  | "novo" // fora da base do BI: cliente cadastrado no mês
  | "semVisita" // fora da base do BI: sem dia de visita no cadastro
  | "foraBase" // fora da base do BI: outros
  | "setor" // os dois contam, em setores diferentes
  | "biSim" // BI diz que comprou, acomp não tem nota
  | "biNao"; // acomp tem nota, BI diz que não comprou

export const MOTIVOS_DIVERGENCIA: Record<MotivoDivergencia, { texto: string; detalhe: string }> = {
  balcao: { texto: "Balcão / sem RN", detalhe: "Nota sem setor de RN: o acomp conta, o BI não" },
  setorForaBi: { texto: "Setor fora do BI", detalhe: "Faturado por setor que o BI não tem (ex.: Digital)" },
  novo: { texto: "Cliente novo", detalhe: "Cadastrado no mês e ainda fora da base do BI" },
  semVisita: { texto: "Sem dia de visita", detalhe: "Fora da base do BI: cadastro sem dia de visita" },
  foraBase: { texto: "Fora da base do BI", detalhe: "Comprou, mas o BI não lista o PDV" },
  setor: { texto: "Setor diferente", detalhe: "BI conta no setor da carteira; acomp, no setor que faturou" },
  biSim: { texto: "BI sim · acomp não", detalhe: "BI conta compra sem nota no faturado (venda/bonificação)" },
  biNao: { texto: "Acomp sim · BI não", detalhe: "Tem nota faturada, mas o BI não conta" },
};

export type Divergencia = {
  operacao: string;
  pdv: string;
  nome: string;
  cidade: string;
  motivo: MotivoDivergencia;
  setorAcomp: string; // "" = não comprou no acomp
  setorBi: string; // "" = fora da base do BI
};

export type BaseCompradores = {
  geradoEm: string;
  mes: string;
  ultimaEmissao: string;
  rns: Record<string, { gv: string; nome: string }>; // "operação|setor"
  metas: Record<string, number>; // "operação|setor" → meta de compradores
  bi: {
    atualizadoEm: string;
    mes: string;
    operacoes: string[]; // operações que vieram no export do BI (as demais não são comparadas)
    rn: Record<string, number>; // "operação|setor" → compradores no BI
    divergencias: Divergencia[];
  } | null;
  clientes: ClienteCompra[];
};

export async function carregarCompradores(): Promise<BaseCompradores> {
  let b: CompradoresBrutos;
  try {
    b = await carregarJson<CompradoresBrutos>(ARQUIVO_COMPRADORES);
  } catch (erro) {
    console.error(erro);
    return { geradoEm: "", mes: "", ultimaEmissao: "", rns: {}, metas: {}, bi: null, clientes: [] };
  }
  const rns: BaseCompradores["rns"] = {};
  for (const [k, [gv, nome]] of Object.entries(b.rns)) {
    const [op, setor] = k.split("|");
    rns[`${b.operacoes[Number(op)]}|${setor}`] = { gv, nome };
  }
  const metas: BaseCompradores["metas"] = {};
  for (const [k, meta] of Object.entries(b.metas ?? {})) {
    const [op, setor] = k.split("|");
    metas[`${b.operacoes[Number(op)]}|${setor}`] = meta;
  }
  return {
    geradoEm: b.geradoEm,
    mes: b.mes,
    ultimaEmissao: b.ultimaEmissao,
    rns,
    metas,
    bi: b.bi
      ? {
          atualizadoEm: b.bi.atualizadoEm,
          mes: b.bi.mes,
          operacoes: b.bi.operacoes ? b.bi.operacoes.map((i) => b.operacoes[i]) : b.operacoes,
          rn: Object.fromEntries(
            Object.entries(b.bi.rn).map(([k, n]) => {
              const [op, setor] = k.split("|");
              return [`${b.operacoes[Number(op)]}|${setor}`, n];
            })
          ),
          divergencias: b.bi.divergencias.map(([op, pdv, nome, cidade, motivo, setorAcomp, setorBi]) => ({
            operacao: b.operacoes[op],
            pdv,
            nome,
            cidade,
            motivo,
            setorAcomp,
            setorBi,
          })),
        }
      : null,
    clientes: b.clientes.map(([op, pdv, nome, cidade, setor, carteira, sit, notas, valor, ultima, visita]) => {
      const operacao = b.operacoes[op];
      const rn = rns[`${operacao}|${setor}`];
      return {
        operacao,
        pdv,
        nome,
        cidade,
        setor,
        gv: rn?.gv ?? "",
        rn: rn?.nome ?? "",
        carteira,
        situacao: sit === 1 ? "venda" : sit === 2 ? "bonificacao" : "nao",
        notas,
        valor,
        ultimaCompra: ultima,
        visita: visita ?? "",
      };
    }),
  };
}

// ==================================================
// FORMATAÇÃO
// ==================================================

export function dinheiro(valor: number | null | undefined) {
  if (valor === null || valor === undefined) return "—";
  return valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
}

/** Valor em reais com sinal explícito: "+R$ 1.200", "−R$ 850". */
export function dinheiroSinal(valor: number | null | undefined) {
  if (valor === null || valor === undefined) return "—";
  if (valor === 0) return dinheiro(0);
  return `${valor > 0 ? "+" : "−"}${dinheiro(Math.abs(valor))}`;
}

/**
 * Gap de faturamento = REAL TASK − META TASK (colunas do fScore).
 * Negativo: abaixo da meta. Positivo: acima. null quando o PDV não tem meta.
 */
export function gapFaturamento(f: { meta: number | null; realizado: number }) {
  return f.meta === null ? null : f.realizado - f.meta;
}

export function numero(valor: number | null | undefined) {
  if (valor === null || valor === undefined) return "0";
  return valor.toLocaleString("pt-BR");
}

export function percentual(valor: number | null | undefined) {
  if (valor === null || valor === undefined) return "—";
  return `${valor.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

export function plural(qtd: number, singular: string, pluralTxt: string) {
  return `${qtd} ${qtd === 1 ? singular : pluralTxt}`;
}

const UNIDADES: Record<string, string> = { Duzia: "dz", Caixa: "cx", Litro: "L", Unidade: "un" };

export function unidadeCurta(unidade: string) {
  return UNIDADES[unidade] ?? unidade.toLowerCase();
}

export function descreveItem(item: ItemEstoque) {
  return `${item.descricao} (${numero(item.saldo)} ${unidadeCurta(item.unidade)})`;
}

// ==================================================
// VISITA
// O campo vem no formato "SEG/QUI/". Quebramos em dias
// para o filtro funcionar por dia da semana.
// ==================================================

export const DIAS_SEMANA = ["SEG", "TER", "QUA", "QUI", "SEX", "SAB", "DOM"];

export function diasVisita(visita: string) {
  return visita
    .split("/")
    .map((d) => d.trim().toUpperCase())
    .filter(Boolean);
}

export const NOME_DIA: Record<string, string> = {
  SEG: "Segunda-feira",
  TER: "Terça-feira",
  QUA: "Quarta-feira",
  QUI: "Quinta-feira",
  SEX: "Sexta-feira",
  SAB: "Sábado",
  DOM: "Domingo",
};

// Operações ficam na PB e na BA — ambos sem horário de verão, UTC-3.
const FUSO = "America/Fortaleza";

/** Dia da semana de hoje no formato do campo VISITA ("SEG", "TER", ...). */
export function diaDeHoje(agora: Date) {
  const curto = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: FUSO }).format(agora);
  const mapa: Record<string, string> = {
    Mon: "SEG", Tue: "TER", Wed: "QUA", Thu: "QUI", Fri: "SEX", Sat: "SAB", Sun: "DOM",
  };
  return mapa[curto] ?? "SEG";
}

export function dataHora(agora: Date) {
  return agora.toLocaleString("pt-BR", {
    timeZone: FUSO,
    dateStyle: "short",
    timeStyle: "short",
  });
}

/** AAAA-MM-DD no fuso local, para nome de arquivo. */
export function dataISO(agora: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(agora);
}

export function competenciaTexto(competencia: string | undefined) {
  return competencia?.replace(/^(\d{4})(\d{2})$/, "$2/$1") ?? "—";
}

// ==================================================
// INTELIGÊNCIA COMERCIAL
// ==================================================

export type SkuSugerido = {
  nome: string;
  coluna: number;
  /** "NOVA" = categoria ainda não positivada; "VERSAO" = nova versão de categoria já positivada */
  tipo: "NOVA" | "VERSAO";
  /** Quantas cestas pendentes do PDV esse SKU ajuda a fechar ao mesmo tempo */
  alavanca: number;
  /** Produtos da grade que atendem a sugestão (vazio quando o estoque não está integrado) */
  itens: ItemEstoque[];
};

export type AcaoCesta = {
  cesta: Cesta;
  sugeridos: SkuSugerido[];
  titulo: string;
  detalhe: string;
  /** true quando a unidade do PDV tem grade de estoque integrada */
  comEstoque: boolean;
  /** SKUs que faltam e que o estoque não consegue cobrir */
  semCobertura: number;
  /** Categorias não positivadas que estão sem estoque (ou não mapeadas) */
  bloqueados: string[];
};

/**
 * Para cada coluna de produto, conta em quantas cestas PENDENTES
 * ela aparece. Ex.: no CORE, "AP 600" conta para Core 600 e Core RGB.
 * Vender esse SKU avança duas cestas de uma vez.
 */
function mapaAlavanca(cliente: Cliente) {
  const mapa = new Map<number, number>();
  for (const cesta of cliente.cestas) {
    if (cesta.status !== "PENDENTE") continue;
    for (const p of cesta.produtos) {
      mapa.set(p.coluna, (mapa.get(p.coluna) ?? 0) + 1);
    }
  }
  return mapa;
}

export function temEstoqueIntegrado(cliente: Cliente) {
  return Boolean(cliente.unidadeEstoque);
}

const cacheAcoes = new WeakMap<Cliente, AcaoCesta[]>();

export function acoesPorCesta(cliente: Cliente): AcaoCesta[] {
  const emCache = cacheAcoes.get(cliente);
  if (emCache) return emCache;

  const alavanca = mapaAlavanca(cliente);
  const comEstoque = temEstoqueIntegrado(cliente);

  const acoes = cliente.cestas.map((cesta): AcaoCesta => {
    const base = {
      cesta,
      sugeridos: [] as SkuSugerido[],
      comEstoque,
      semCobertura: 0,
      bloqueados: [] as string[],
    };

    if (cesta.status === "SEM_META") {
      return {
        ...base,
        titulo: "Sem meta",
        detalhe: "PDV sem meta nesta cesta. Nenhuma ação obrigatória.",
      };
    }

    const positivados = cesta.produtos.filter((p) => p.realizado > 0);

    if (cesta.status === "CONCLUIDA") {
      const semGiro = comEstoque
        ? positivados
            .filter((p) => p.estoque && p.estoque.status === "SEM_ESTOQUE")
            .map((p) => p.nome)
        : [];
      return {
        ...base,
        titulo: "Cesta fechada — garantir recompra",
        detalhe:
          (positivados.length > 0
            ? `Manter giro de ${positivados.map((p) => p.nome).join(", ")} para não perder a cesta.`
            : "Manter execução e recompra.") +
          (semGiro.length ? ` Atenção: ${semGiro.join(", ")} sem estoque no momento.` : ""),
      };
    }

    const faltam = cesta.faltam ?? 0;
    const saldo = (p: Produto) => p.estoque?.saldo ?? 0;
    // Mais alavanca primeiro; com estoque, desempata pelo maior saldo disponível
    const ordenar = (a: Produto, b: Produto) =>
      (alavanca.get(b.coluna) ?? 0) - (alavanca.get(a.coluna) ?? 0) || saldo(b) - saldo(a);

    // Com estoque integrado, só entra o que pode ser entregue.
    const disponivel = (p: Produto) => !comEstoque || p.estoque?.status === "DISPONIVEL";
    // Nova versão só faz sentido se a grade tem mais versões do que o PDV já compra.
    const temOutraVersao = (p: Produto) =>
      !comEstoque ||
      (p.estoque?.status === "DISPONIVEL" && p.estoque.itens.length > p.realizado);

    const naoPositivados = cesta.produtos.filter((p) => p.realizado === 0);
    const novas = naoPositivados.filter(disponivel).sort(ordenar);
    const versoes = positivados.filter(temOutraVersao).sort(ordenar);
    const bloqueados = comEstoque
      ? naoPositivados.filter((p) => !disponivel(p)).map((p) => p.nome)
      : [];

    const paraSugestao = (p: Produto, tipo: SkuSugerido["tipo"]): SkuSugerido => ({
      nome: p.nome,
      coluna: p.coluna,
      tipo,
      alavanca: alavanca.get(p.coluna) ?? 1,
      itens: p.estoque?.itens ?? [],
    });

    const sugeridos = [
      ...novas.map((p) => paraSugestao(p, "NOVA")),
      ...versoes.map((p) => paraSugestao(p, "VERSAO")),
    ].slice(0, faltam);

    const semCobertura = Math.max(0, faltam - sugeridos.length);

    const lista = sugeridos
      .map((s) => {
        const nome = s.tipo === "VERSAO" ? `+1 versão de ${s.nome}` : s.nome;
        const produto = s.itens[0];
        return comEstoque && produto ? `${nome} → ${descreveItem(produto)}` : nome;
      })
      .join("; ");

    let titulo =
      faltam === 1 ? "Falta 1 SKU para fechar" : `Vender ${faltam} SKUs distintos`;
    let detalhe = sugeridos.length ? `Ofertar: ${lista}.` : "";

    if (semCobertura > 0) {
      titulo =
        sugeridos.length === 0
          ? "Sem estoque para avançar"
          : `Estoque cobre ${sugeridos.length} de ${faltam} SKUs`;
      detalhe +=
        (detalhe ? " " : "") +
        `${plural(semCobertura, "SKU", "SKUs")} sem estoque na unidade` +
        (bloqueados.length ? ` (${bloqueados.join(", ")})` : "") +
        ". Acionar supervisor/reposição.";
    }

    return { ...base, sugeridos, titulo, detalhe, semCobertura, bloqueados };
  });

  cacheAcoes.set(cliente, acoes);
  return acoes;
}

/** Cestas pendentes que o vendedor consegue fechar com o estoque atual, menor gap primeiro. */
function cestasFechaveis(cliente: Cliente) {
  return acoesPorCesta(cliente)
    .filter((a) => a.cesta.status === "PENDENTE" && a.semCobertura === 0)
    .sort((a, b) => (a.cesta.faltam ?? 0) - (b.cesta.faltam ?? 0));
}

export type ProximaAcao = {
  texto: string;
  tom: "urgente" | "atencao" | "ok" | "neutro";
};

export function proximaAcao(cliente: Cliente): ProximaAcao {
  const fechaveis = cestasFechaveis(cliente);

  if (fechaveis.length > 0) {
    const maisPerto = fechaveis[0].cesta;
    const faltam = maisPerto.faltam ?? 0;
    return {
      texto:
        faltam === 1
          ? `1 SKU fecha ${maisPerto.nome}`
          : `${faltam} SKUs para fechar ${maisPerto.nome}`,
      tom: faltam === 1 ? "urgente" : "atencao",
    };
  }

  if (cliente.faturamento.status === "PENDENTE") {
    return {
      texto: `Faturar ${dinheiro(cliente.faturamento.faltam)} p/ meta`,
      tom: "atencao",
    };
  }

  if (cliente.cestasPendentes > 0) {
    return { texto: "Cesta travada: falta estoque", tom: "neutro" };
  }

  if (cliente.cestasComMeta > 0 || cliente.faturamento.status === "CONCLUIDA") {
    return { texto: "Tudo fechado — manter recompra", tom: "ok" };
  }

  return { texto: "Sem metas no ciclo", tom: "neutro" };
}

/**
 * Menor nº de SKUs para fechar uma cesta COM estoque disponível.
 * Cestas que o estoque não cobre não contam: o vendedor não consegue fechá-las agora.
 */
export function menorGap(cliente: Cliente) {
  const fechaveis = cestasFechaveis(cliente);
  return fechaveis.length ? fechaveis[0].cesta.faltam ?? 0 : Infinity;
}

/**
 * Prioridade comercial: quanto menor, mais cedo o vendedor deve atacar.
 * 1) PDVs que fecham uma cesta com poucos SKUs, com estoque (ganho rápido)
 * 2) Depois, maior gap de faturamento
 * 3) PDVs sem pendência vão para o fim
 */
export function comparaPrioridade(a: Cliente, b: Cliente) {
  const ga = menorGap(a);
  const gb = menorGap(b);
  if (ga !== gb) return ga === Infinity ? 1 : gb === Infinity ? -1 : ga - gb;

  const fa = a.faturamento.faltam ?? 0;
  const fb = b.faturamento.faltam ?? 0;
  if (fa !== fb) return fb - fa;

  return a.nomeFantasia.localeCompare(b.nomeFantasia, "pt-BR");
}

// Agrupamento de operações por região (filtro "Região")
export const REGIOES: Record<string, string[]> = {
  Patos: ["Pau Brasil Patos", "Pau Brasil FL"],
  Sousa: ["Pau Brasil Sousa", "Pau Brasil FL / Itaporanga"],
  Guarabira: ["Pau Brasil Guarabira"],
  Bahia: ["Pau Brasil Brumado", "Pau Brasil Caculé", "Pau Brasil Barra da Estiva"],
};

export function regiaoDaOperacao(operacao: string): string | null {
  for (const [regiao, operacoes] of Object.entries(REGIOES)) {
    if (operacoes.includes(operacao)) return regiao;
  }
  return null;
}

export function opcoes(valores: string[]) {
  return [...new Set(valores)]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
}
