import fs from "node:fs/promises";
import path from "node:path";

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
    status: StatusMeta;
  };
  cestas: Cesta[];
  cestasComMeta: number;
  cestasPendentes: number;
  cestasConcluidas: number;
  skusFaltantes: number;
};

export async function carregarClientes(): Promise<Cliente[]> {
  const caminho = path.join(
    process.cwd(),
    "dados",
    "processados",
    "clientes-score5.json"
  );

  const conteudo = await fs.readFile(caminho, "utf8");
  return JSON.parse(conteudo) as Cliente[];
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

export function opcoes(valores: string[]) {
  return [...new Set(valores)]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
}
