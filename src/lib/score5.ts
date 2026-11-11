import fs from "node:fs/promises";
import path from "node:path";

// ==================================================
// TIPOS (espelham dados/processados/clientes-score5.json)
// ==================================================

export type StatusMeta = "CONCLUIDA" | "PENDENTE" | "SEM_META";

export type Produto = {
  nome: string;
  coluna: number;
  realizado: number;
  comprado: boolean;
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
};

export type AcaoCesta = {
  cesta: Cesta;
  sugeridos: SkuSugerido[];
  titulo: string;
  detalhe: string;
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

export function acoesPorCesta(cliente: Cliente): AcaoCesta[] {
  const alavanca = mapaAlavanca(cliente);

  return cliente.cestas.map((cesta) => {
    if (cesta.status === "SEM_META") {
      return {
        cesta,
        sugeridos: [],
        titulo: "Sem meta",
        detalhe: "PDV sem meta nesta cesta. Nenhuma ação obrigatória.",
      };
    }

    const positivados = cesta.produtos.filter((p) => p.realizado > 0);

    if (cesta.status === "CONCLUIDA") {
      return {
        cesta,
        sugeridos: [],
        titulo: "Cesta fechada — garantir recompra",
        detalhe:
          positivados.length > 0
            ? `Manter giro de ${positivados.map((p) => p.nome).join(", ")} para não perder a cesta.`
            : "Manter execução e recompra.",
      };
    }

    const faltam = cesta.faltam ?? 0;
    const ordenar = (a: Produto, b: Produto) =>
      (alavanca.get(b.coluna) ?? 0) - (alavanca.get(a.coluna) ?? 0);

    // 1º categorias zeradas (mais alavanca primeiro), 2º nova versão de categoria já positivada
    const novas = cesta.produtos.filter((p) => p.realizado === 0).sort(ordenar);
    const versoes = positivados.sort(ordenar);

    const sugeridos: SkuSugerido[] = [
      ...novas.map((p) => ({
        nome: p.nome,
        coluna: p.coluna,
        tipo: "NOVA" as const,
        alavanca: alavanca.get(p.coluna) ?? 1,
      })),
      ...versoes.map((p) => ({
        nome: p.nome,
        coluna: p.coluna,
        tipo: "VERSAO" as const,
        alavanca: alavanca.get(p.coluna) ?? 1,
      })),
    ].slice(0, faltam);

    const lista = sugeridos
      .map((s) => (s.tipo === "VERSAO" ? `+1 versão de ${s.nome}` : s.nome))
      .join(", ");

    return {
      cesta,
      sugeridos,
      titulo:
        faltam === 1
          ? "Falta 1 SKU para fechar"
          : `Vender ${faltam} SKUs distintos`,
      detalhe: `Ofertar: ${lista}.`,
    };
  });
}

export type ProximaAcao = {
  texto: string;
  tom: "urgente" | "atencao" | "ok" | "neutro";
};

export function proximaAcao(cliente: Cliente): ProximaAcao {
  const pendentes = cliente.cestas
    .filter((c) => c.status === "PENDENTE")
    .sort((a, b) => (a.faltam ?? 0) - (b.faltam ?? 0));

  const fatPendente = cliente.faturamento.status === "PENDENTE";

  if (pendentes.length > 0) {
    const maisPerto = pendentes[0];
    const faltam = maisPerto.faltam ?? 0;
    return {
      texto:
        faltam === 1
          ? `1 SKU fecha ${maisPerto.nome}`
          : `${faltam} SKUs para fechar ${maisPerto.nome}`,
      tom: faltam === 1 ? "urgente" : "atencao",
    };
  }

  if (fatPendente) {
    return {
      texto: `Faturar ${dinheiro(cliente.faturamento.faltam)} p/ meta`,
      tom: "atencao",
    };
  }

  if (cliente.cestasComMeta > 0 || cliente.faturamento.status === "CONCLUIDA") {
    return { texto: "Tudo fechado — manter recompra", tom: "ok" };
  }

  return { texto: "Sem metas no ciclo", tom: "neutro" };
}

/** SKUs que fecham a cesta pendente mais próxima (menor gap). */
export function menorGap(cliente: Cliente) {
  const gaps = cliente.cestas
    .filter((c) => c.status === "PENDENTE")
    .map((c) => c.faltam ?? 0);
  return gaps.length ? Math.min(...gaps) : Infinity;
}

/**
 * Prioridade comercial: quanto menor, mais cedo o vendedor deve atacar.
 * 1) PDVs que fecham uma cesta com poucos SKUs (ganho rápido)
 * 2) Depois, maior gap de faturamento
 * 3) PDVs sem pendência vão para o fim
 */
export function comparaPrioridade(a: Cliente, b: Cliente) {
  const ga = menorGap(a);
  const gb = menorGap(b);
  if (ga !== gb) return ga - gb;

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
