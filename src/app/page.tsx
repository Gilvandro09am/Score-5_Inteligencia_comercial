import Link from "next/link";
import { Suspense } from "react";
import { CampoSelect } from "@/components/CampoSelect";
import {
  acoesPorCesta,
  carregarClientes,
  comparaPrioridade,
  DIAS_SEMANA,
  diasVisita,
  dinheiro,
  dinheiroSinal,
  gapFaturamento,
  menorGap,
  numero,
  opcoes,
  percentual,
  plural,
  proximaAcao,
  type AcaoCesta,
  type Cliente,
  type ProximaAcao,
  type StatusMeta,
  unidadeCurta,
} from "@/lib/score5";

// ==================================================
// FILTROS (via querystring — funciona sem JavaScript no cliente)
// ==================================================

const CHAVES_FILTRO = [
  "operacao",
  "gv",
  "setor",
  "visita",
  "pdv",
  "nome",
  "situacao",
  "ordem",
] as const;

type Filtros = Record<(typeof CHAVES_FILTRO)[number], string>;

const SITUACOES: Record<string, string> = {
  pendente: "Com cesta pendente",
  rapido: "Fecha cesta com 1 SKU",
  faturamento: "Faturamento abaixo da meta",
  fechado: "Tudo fechado",
};

const ORDENS: Record<string, string> = {
  prioridade: "Prioridade comercial",
  nome: "Nome fantasia (A–Z)",
  skus: "Mais SKUs a vender",
  faturamento: "Maior gap de faturamento",
};

function urlCom(filtros: Filtros, extra: Record<string, string> = {}) {
  const params = new URLSearchParams();
  for (const chave of CHAVES_FILTRO) {
    if (filtros[chave]) params.set(chave, filtros[chave]);
  }
  for (const [k, v] of Object.entries(extra)) {
    if (v) params.set(k, v);
    else params.delete(k);
  }
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

function aplicaSituacao(c: Cliente, situacao: string) {
  switch (situacao) {
    case "pendente":
      return c.cestasPendentes > 0;
    case "rapido":
      return menorGap(c) === 1;
    case "faturamento":
      return c.faturamento.status === "PENDENTE";
    case "fechado":
      return (
        c.cestasPendentes === 0 &&
        c.faturamento.status !== "PENDENTE" &&
        (c.cestasComMeta > 0 || c.faturamento.status === "CONCLUIDA")
      );
    default:
      return true;
  }
}

function ordenar(lista: Cliente[], ordem: string) {
  const copia = [...lista];
  switch (ordem) {
    case "nome":
      return copia.sort((a, b) =>
        a.nomeFantasia.localeCompare(b.nomeFantasia, "pt-BR")
      );
    case "skus":
      return copia.sort((a, b) => b.skusFaltantes - a.skusFaltantes);
    case "faturamento":
      return copia.sort(
        // Maior gap negativo (mais abaixo da meta) primeiro; sem meta por último
        (a, b) =>
          (gapFaturamento(a.faturamento) ?? Infinity) -
          (gapFaturamento(b.faturamento) ?? Infinity)
      );
    default:
      return copia.sort(comparaPrioridade);
  }
}

// ==================================================
// ESTILOS DE STATUS
// ==================================================

const ESTILO_STATUS: Record<StatusMeta, string> = {
  CONCLUIDA: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  PENDENTE: "bg-amber-50 text-amber-800 ring-amber-600/20",
  SEM_META: "bg-slate-50 text-slate-500 ring-slate-500/15",
};

const TEXTO_STATUS: Record<StatusMeta, string> = {
  CONCLUIDA: "Fechada",
  PENDENTE: "Pendente",
  SEM_META: "Sem meta",
};

const ESTILO_ACAO: Record<ProximaAcao["tom"], string> = {
  urgente: "bg-rose-50 text-rose-700 ring-rose-600/20",
  atencao: "bg-amber-50 text-amber-800 ring-amber-600/20",
  ok: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  neutro: "bg-slate-50 text-slate-500 ring-slate-500/15",
};

function Selo({ status }: { status: StatusMeta }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${ESTILO_STATUS[status]}`}
    >
      {TEXTO_STATUS[status]}
    </span>
  );
}

function Barra({
  valor,
  status,
}: {
  valor: number | null;
  status: StatusMeta;
}) {
  const largura = Math.max(0, Math.min(100, valor ?? 0));
  const cor =
    status === "CONCLUIDA"
      ? "bg-emerald-500"
      : status === "PENDENTE"
        ? "bg-amber-500"
        : "bg-slate-300";
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
      <div className={`h-full rounded-full ${cor}`} style={{ width: `${largura}%` }} />
    </div>
  );
}

// ==================================================
// COMPONENTES
// ==================================================

function Kpi({
  titulo,
  valor,
  detalhe,
  destaque,
}: {
  titulo: string;
  valor: string;
  detalhe: string;
  destaque?: "rose" | "amber" | "emerald";
}) {
  const borda =
    destaque === "rose"
      ? "border-l-rose-500"
      : destaque === "amber"
        ? "border-l-amber-500"
        : destaque === "emerald"
          ? "border-l-emerald-500"
          : "border-l-slate-300";
  return (
    <div
      className={`rounded-xl border border-slate-200 border-l-4 ${borda} bg-white px-4 py-3.5 shadow-sm`}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {titulo}
      </p>
      <p className="mt-1.5 text-2xl font-bold tabular-nums text-slate-900">
        {valor}
      </p>
      <p className="mt-0.5 text-xs text-slate-500">{detalhe}</p>
    </div>
  );
}

function CampoTexto({
  nome,
  rotulo,
  valor,
  placeholder,
  sugestoes,
}: {
  nome: string;
  rotulo: string;
  valor: string;
  placeholder: string;
  sugestoes: string[];
}) {
  const idLista = `lista-${nome}`;
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-medium text-slate-600">{rotulo}</span>
      <input
        name={nome}
        defaultValue={valor}
        placeholder={placeholder}
        list={idLista}
        autoComplete="off"
        className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
      />
      <datalist id={idLista}>
        {sugestoes.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </label>
  );
}

/** Uma faixa horizontal por cesta: status → SKUs → ação do vendedor */
function FaixaCesta({ acao }: { acao: AcaoCesta }) {
  const { cesta, sugeridos } = acao;
  const sugeridosCol = new Map(sugeridos.map((s) => [s.coluna, s]));
  const semMeta = cesta.status === "SEM_META";

  const corAcao =
    cesta.status === "PENDENTE"
      ? "border-amber-200 bg-amber-50"
      : cesta.status === "CONCLUIDA"
        ? "border-emerald-200 bg-emerald-50"
        : "border-slate-200 bg-slate-50";

  const corTituloAcao =
    cesta.status === "PENDENTE"
      ? "text-amber-900"
      : cesta.status === "CONCLUIDA"
        ? "text-emerald-800"
        : "text-slate-600";

  return (
    <div
      className={`grid gap-4 border-t border-slate-100 p-4 first:border-t-0 lg:grid-cols-[220px_minmax(0,1fr)_300px] lg:items-center ${
        semMeta ? "opacity-60" : ""
      }`}
    >
      {/* 1. Cesta */}
      <div>
        <div className="flex items-center justify-between gap-2">
          <h4 className="font-semibold text-slate-900">{cesta.nome}</h4>
          <Selo status={cesta.status} />
        </div>
        {!semMeta && (
          <>
            <p className="mt-1.5 text-sm tabular-nums text-slate-600">
              <span className="font-semibold text-slate-900">{cesta.realizado}</span>
              {" / "}
              {cesta.meta} SKUs · {percentual(cesta.atingimento)}
            </p>
            <div className="mt-2">
              <Barra valor={cesta.atingimento} status={cesta.status} />
            </div>
          </>
        )}
      </div>

      {/* 2. SKUs em linha */}
      <div className="min-w-0">
        <div className="flex gap-1.5 overflow-x-auto pb-1 lg:flex-wrap lg:overflow-visible">
          {cesta.produtos.map((p) => {
            const sug = sugeridosCol.get(p.coluna);
            const comprado = p.realizado > 0;
            const semEstoque =
              acao.comEstoque && !comprado && p.estoque?.status !== "DISPONIVEL";
            const estilo = sug
              ? "border-amber-400 bg-amber-100 text-amber-900"
              : comprado
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : semEstoque
                  ? "border-dashed border-slate-300 bg-slate-50 text-slate-400 line-through"
                  : "border-slate-200 bg-white text-slate-500";
            const saldoTxt =
              p.estoque?.status === "DISPONIVEL"
                ? ` · estoque: ${numero(p.estoque.saldo)} ${unidadeCurta(p.estoque.itens[0]?.unidade ?? "")}`
                : "";
            return (
              <span
                key={p.coluna}
                title={
                  (sug
                    ? sug.alavanca > 1
                      ? `Sugerido — conta para ${sug.alavanca} cestas pendentes`
                      : "Sugerido para fechar a cesta"
                    : comprado
                      ? `Positivado (${p.realizado} versão(ões))`
                      : semEstoque
                        ? p.estoque?.status === "NAO_MAPEADO"
                          ? "Categoria sem produto definido na grade de estoque"
                          : "Sem estoque na unidade"
                        : "Não positivado") + saldoTxt
                }
                className={`inline-flex flex-none items-center gap-1 whitespace-nowrap rounded-md border px-2 py-1 text-xs font-medium ${estilo}`}
              >
                <span aria-hidden>{comprado ? "✓" : sug ? "→" : semEstoque ? "✕" : "○"}</span>
                {p.nome}
                {p.realizado > 1 && (
                  <span className="rounded bg-emerald-600/10 px-1 tabular-nums">
                    ×{p.realizado}
                  </span>
                )}
                {sug && sug.alavanca > 1 && (
                  <span className="rounded bg-amber-600/15 px-1">{sug.alavanca} cestas</span>
                )}
              </span>
            );
          })}
        </div>
      </div>

      {/* 3. Ação do vendedor */}
      <div className={`rounded-lg border px-3 py-2.5 ${corAcao}`}>
        <p className={`text-xs font-bold uppercase tracking-wide ${corTituloAcao}`}>
          {acao.titulo}
        </p>
        {acao.comEstoque && sugeridos.length > 0 ? (
          <>
            <ul className="mt-1.5 space-y-1.5">
              {sugeridos.map((s) => {
                const item = s.itens[0];
                return (
                  <li key={s.coluna} className="text-sm leading-snug text-slate-700">
                    <span className="font-semibold text-slate-900">
                      {s.tipo === "VERSAO" ? `+1 versão ${s.nome}` : s.nome}
                    </span>
                    {item && (
                      <span className="block text-xs text-slate-600">
                        Cód. {item.codigo} · {item.descricao} ·{" "}
                        <span className="font-semibold text-emerald-700">
                          {numero(item.saldo)} {unidadeCurta(item.unidade)}
                        </span>
                        {s.itens.length > 1 && ` (+${s.itens.length - 1} opção)`}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            {acao.semCobertura > 0 && (
              <p className="mt-2 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-800">
                {plural(acao.semCobertura, "SKU", "SKUs")} sem estoque
                {acao.bloqueados.length > 0 && ` (${acao.bloqueados.join(", ")})`} — acionar
                supervisor/reposição.
              </p>
            )}
          </>
        ) : (
          <p className="mt-1 text-sm leading-snug text-slate-700">{acao.detalhe}</p>
        )}
      </div>
    </div>
  );
}

function PainelPdv({ cliente, urlFechar }: { cliente: Cliente; urlFechar: string }) {
  const acoes = acoesPorCesta(cliente);
  const fat = cliente.faturamento;
  const pendentes = acoes
    .filter((a) => a.cesta.status === "PENDENTE")
    .sort((a, b) => (a.cesta.faltam ?? 0) - (b.cesta.faltam ?? 0));

  // Roteiro: passos numerados na ordem em que o vendedor deve atacar
  const roteiro: string[] = [];
  // Cestas que o estoque permite fechar vêm antes das travadas
  const ordenadas = [
    ...pendentes.filter((a) => a.semCobertura === 0),
    ...pendentes.filter((a) => a.semCobertura > 0),
  ];
  for (const a of ordenadas) {
    const nomes = a.sugeridos
      .map((s) => {
        const nome = s.tipo === "VERSAO" ? `+1 versão ${s.nome}` : s.nome;
        const item = a.comEstoque ? s.itens[0] : undefined;
        return item ? `${nome}: ${item.descricao}` : nome;
      })
      .join(", ");
    const faltam = a.cesta.faltam ?? 0;
    if (a.semCobertura === 0) {
      roteiro.push(
        `Fechar ${a.cesta.nome}: positivar ${plural(faltam, "SKU", "SKUs")} (${nomes}).`
      );
    } else if (a.sugeridos.length > 0) {
      roteiro.push(
        `Avançar ${a.cesta.nome}: positivar ${plural(a.sugeridos.length, "SKU", "SKUs")} com estoque (${nomes}). ` +
          `${plural(a.semCobertura, "SKU depende", "SKUs dependem")} de reposição.`
      );
    } else {
      roteiro.push(
        `${a.cesta.nome}: faltam ${plural(faltam, "SKU", "SKUs")}, mas não há estoque na unidade — sinalizar ao supervisor.`
      );
    }
  }
  if (fat.status === "PENDENTE") {
    roteiro.push(
      `Faturamento: real ${dinheiro(fat.realizado)} de meta ${dinheiro(fat.meta)} (gap ${dinheiroSinal(gapFaturamento(fat))}) — ampliar volume dos itens de maior giro.`
    );
  }
  const fechadas = acoes.filter((a) => a.cesta.status === "CONCLUIDA");
  if (fechadas.length > 0) {
    roteiro.push(
      `Proteger ${fechadas.map((a) => a.cesta.nome).join(", ")}: garantir recompra dos SKUs já positivados.`
    );
  }

  return (
    <section
      id="painel"
      className="scroll-mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
    >
      {/* Cabeçalho do PDV */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 bg-slate-50/60 px-5 py-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600">
            Painel do PDV
          </p>
          <h2 className="mt-1 truncate text-xl font-bold text-slate-900">
            {cliente.nomeFantasia}
          </h2>
          <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-600">
            {[
              ["PDV", cliente.pdv],
              ["Base", cliente.base],
              ["Visita", cliente.visita],
              ["GV", cliente.gv],
              ["Setor", cliente.rn],
              ["Operação", cliente.operacao],
            ].map(([k, v]) => (
              <div key={k} className="flex gap-1">
                <dt className="text-slate-400">{k}</dt>
                <dd className="font-medium text-slate-700">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2">
            {cliente.unidadeEstoque ? (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Estoque {cliente.unidadeEstoque} integrado — sugestões só com produto disponível
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500 ring-1 ring-inset ring-slate-500/15">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                Estoque desta unidade ainda não integrado — confirmar disponibilidade
              </span>
            )}
          </p>
        </div>
        <Link
          href={urlFechar}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Fechar ✕
        </Link>
      </div>

      {/* Números do PDV */}
      <div className="grid grid-cols-2 divide-slate-100 border-b border-slate-200 md:grid-cols-4 md:divide-x">
        {[
          ["Meta Task faturamento", dinheiro(fat.meta)],
          ["Real Task faturamento", dinheiro(fat.realizado)],
          ["Gap (Real − Meta)", dinheiroSinal(gapFaturamento(fat))],
          ["Atingimento", percentual(fat.atingimento)],
        ].map(([k, v]) => (
          <div key={k} className="px-5 py-3">
            <p className="text-xs text-slate-500">{k}</p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{v}</p>
          </div>
        ))}
      </div>

      {/* Roteiro de ação */}
      <div className="border-b border-slate-200 px-5 py-4">
        <h3 className="text-sm font-bold uppercase tracking-wide text-slate-900">
          Roteiro de ação do vendedor
        </h3>
        {roteiro.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Nenhuma meta ativa para este PDV no ciclo.</p>
        ) : (
          <ol className="mt-3 space-y-2">
            {roteiro.map((passo, i) => (
              <li key={i} className="flex gap-3 text-sm text-slate-700">
                <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-indigo-600 text-[11px] font-bold text-white">
                  {i + 1}
                </span>
                <span className="leading-5">{passo}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* Faixas por cesta */}
      <div>
        <div className="hidden grid-cols-[220px_minmax(0,1fr)_300px] gap-4 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 lg:grid">
          <span>Cesta</span>
          <span>SKUs da cesta</span>
          <span>Ação do vendedor</span>
        </div>
        {acoes.map((a) => (
          <FaixaCesta key={a.cesta.id} acao={a} />
        ))}
        <div className="flex flex-wrap gap-4 border-t border-slate-100 bg-slate-50 px-4 py-2.5 text-xs text-slate-500">
          <span>
            <span className="text-emerald-700">✓</span> Positivado (×n = versões)
          </span>
          <span>
            <span className="text-amber-700">→</span> Ofertar nesta visita
          </span>
          <span>○ Não positivado</span>
          {cliente.unidadeEstoque && (
            <span>
              <span className="text-slate-400 line-through">✕ SKU</span> Sem estoque na unidade
            </span>
          )}
          <span>“2 cestas” = um único SKU avança duas cestas</span>
        </div>
      </div>
    </section>
  );
}

// ==================================================
// PÁGINA
// ==================================================

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// Com cacheComponents ativo, a leitura de searchParams precisa ficar dentro
// de um <Suspense> para não bloquear o pré-render da rota.
export default function Home({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-slate-100 text-sm text-slate-500">
          Carregando carteira…
        </main>
      }
    >
      <Painel searchParams={searchParams} />
    </Suspense>
  );
}

async function Painel({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const ler = (nome: string) => {
    const v = params[nome];
    return typeof v === "string" ? v.trim() : "";
  };

  const filtros = Object.fromEntries(
    CHAVES_FILTRO.map((k) => [k, ler(k)])
  ) as Filtros;
  const verPdv = ler("ver");

  const clientes = await carregarClientes();

  // Filtros em cascata: Operação → GV → Setor
  const operacoes = opcoes(clientes.map((c) => c.operacao));
  // Operações com estoque integrado (ex.: "Pau Brasil FL" → "Sumé")
  const unidadePorOperacao = new Map(
    clientes.filter((c) => c.unidadeEstoque).map((c) => [c.operacao, c.unidadeEstoque as string])
  );
  const porOperacao = clientes.filter(
    (c) => !filtros.operacao || c.operacao === filtros.operacao
  );
  const gvs = opcoes(porOperacao.map((c) => c.gv));
  const porGv = porOperacao.filter((c) => !filtros.gv || c.gv === filtros.gv);
  const setores = opcoes(porGv.map((c) => c.rn));
  const porSetor = porGv.filter((c) => !filtros.setor || c.rn === filtros.setor);

  const diasDisponiveis = new Set(porSetor.flatMap((c) => diasVisita(c.visita)));
  const dias = DIAS_SEMANA.filter((d) => diasDisponiveis.has(d));
  if (porSetor.some((c) => c.visita === "Indefinido")) dias.push("Indefinido");

  const termoPdv = filtros.pdv.toLocaleLowerCase("pt-BR");
  const termoNome = filtros.nome.toLocaleLowerCase("pt-BR");

  const filtrados = ordenar(
    porSetor.filter((c) => {
      const okVisita =
        !filtros.visita ||
        (filtros.visita === "Indefinido"
          ? c.visita === "Indefinido"
          : diasVisita(c.visita).includes(filtros.visita));
      const okPdv = !termoPdv || c.pdv.toLocaleLowerCase("pt-BR").includes(termoPdv);
      const okNome =
        !termoNome || c.nomeFantasia.toLocaleLowerCase("pt-BR").includes(termoNome);
      return okVisita && okPdv && okNome && aplicaSituacao(c, filtros.situacao);
    }),
    filtros.ordem
  );

  const selecionado = verPdv ? clientes.find((c) => c.pdv === verPdv) : undefined;

  // Indicadores da carteira filtrada
  const totalCestasMeta = filtrados.reduce((t, c) => t + c.cestasComMeta, 0);
  const totalCestasFechadas = filtrados.reduce((t, c) => t + c.cestasConcluidas, 0);
  const totalSkus = filtrados.reduce((t, c) => t + c.skusFaltantes, 0);
  const fechamentoRapido = filtrados.filter((c) => menorGap(c) === 1).length;
  // Gap da carteira = Real Task − Meta Task, somando só PDVs com meta
  const comMetaFat = filtrados.filter((c) => c.faturamento.meta !== null);
  const totalMetaFat = comMetaFat.reduce((t, c) => t + (c.faturamento.meta ?? 0), 0);
  const totalRealFat = comMetaFat.reduce((t, c) => t + c.faturamento.realizado, 0);
  const gapCarteira = totalRealFat - totalMetaFat;
  const pdvsFatPendente = filtrados.filter((c) => c.faturamento.status === "PENDENTE").length;

  const filtrosAtivos = CHAVES_FILTRO.filter((k) => k !== "ordem" && filtros[k]).length;

  return (
    <main className="min-h-screen bg-slate-100 text-slate-900">
      <header className="border-b border-slate-800 bg-slate-950 text-white">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-4 px-4 py-4 md:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-sm font-black">
              S5
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight tracking-wide">SCORE 5</h1>
              <p className="text-xs text-slate-400">Inteligência Comercial</p>
            </div>
          </div>
          <div className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300">
            Competência{" "}
            <span className="font-semibold text-white">
              {clientes[0]?.competencia.replace(/^(\d{4})(\d{2})$/, "$2/$1") ?? "—"}
            </span>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1400px] space-y-5 px-4 py-6 md:px-6">
        {/* Filtros */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900">
              Filtros da carteira
            </h2>
            {filtrosAtivos > 0 && (
              <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700">
                {plural(filtrosAtivos, "filtro ativo", "filtros ativos")}
              </span>
            )}
          </div>

          <form method="GET" className="space-y-3">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
              <CampoSelect
                nome="operacao"
                rotulo="Operação"
                valor={filtros.operacao}
                todos="Todas"
                itens={operacoes.map((o) => {
                  const unidade = unidadePorOperacao.get(o);
                  const nome = o.replace(/^Pau Brasil /, "");
                  return {
                    valor: o,
                    texto: unidade && unidade !== nome ? `${nome} (${unidade}) · estoque` : unidade ? `${nome} · estoque` : nome,
                  };
                })}
              />
              <CampoSelect
                nome="gv"
                rotulo="GV"
                valor={filtros.gv}
                itens={gvs.map((g) => ({ valor: g, texto: g === "-1" ? "Sem GV" : `GV ${g}` }))}
              />
              <CampoSelect
                nome="setor"
                rotulo="Setor"
                valor={filtros.setor}
                itens={setores.map((s) => ({ valor: s, texto: s === "-1" ? "Sem setor" : s }))}
              />
              <CampoSelect
                nome="visita"
                rotulo="Dia de visita"
                valor={filtros.visita}
                itens={dias.map((d) => ({ valor: d, texto: d }))}
              />
              <CampoTexto
                nome="pdv"
                rotulo="PDV"
                valor={filtros.pdv}
                placeholder="Código do PDV"
                sugestoes={porSetor.map((c) => c.pdv).slice(0, 500)}
              />
              <div className="col-span-2 md:col-span-1 xl:col-span-1">
                <CampoTexto
                  nome="nome"
                  rotulo="Nome fantasia"
                  valor={filtros.nome}
                  placeholder="Buscar cliente"
                  sugestoes={opcoes(porSetor.map((c) => c.nomeFantasia)).slice(0, 500)}
                />
              </div>
              <CampoSelect
                nome="situacao"
                rotulo="Situação"
                valor={filtros.situacao}
                todos="Todas"
                itens={Object.entries(SITUACOES).map(([valor, texto]) => ({ valor, texto }))}
              />
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-medium text-slate-600">Ordenar por</span>
                <select
                  name="ordem"
                  defaultValue={filtros.ordem || "prioridade"}
                  className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                >
                  {Object.entries(ORDENS).map(([valor, texto]) => (
                    <option key={valor} value={valor}>
                      {texto}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                className="h-10 rounded-lg bg-indigo-600 px-5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
              >
                Aplicar filtros
              </button>
              <Link
                href="/"
                className="flex h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Limpar
              </Link>
              <Link
                href={`/relatorio?${new URLSearchParams(
                  Object.entries({
                    operacao: filtros.operacao,
                    gv: filtros.gv,
                    setor: filtros.setor,
                    visita: filtros.visita === "Indefinido" ? "" : filtros.visita,
                  }).filter(([, v]) => v)
                ).toString()}`}
                className="flex h-10 items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-4 text-sm font-semibold text-indigo-700 hover:bg-indigo-100"
              >
                Roteiro do GV (PDF)
              </Link>
              <p className="ml-auto text-xs text-slate-500">
                Operação, GV e Setor são em cascata — aplique para atualizar as opções.
              </p>
            </div>
          </form>
        </section>

        {/* Indicadores */}
        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Kpi titulo="PDVs na carteira" valor={numero(filtrados.length)} detalhe="Após filtros" />
          <Kpi
            titulo="Fecha com 1 SKU"
            valor={numero(fechamentoRapido)}
            detalhe="PDVs a 1 SKU de fechar (com estoque)"
            destaque="rose"
          />
          <Kpi
            titulo="SKUs a positivar"
            valor={numero(totalSkus)}
            detalhe="Soma dos gaps de cesta"
            destaque="amber"
          />
          <Kpi
            titulo="Cestas fechadas"
            valor={totalCestasMeta ? percentual(Math.round((totalCestasFechadas / totalCestasMeta) * 1000) / 10) : "—"}
            detalhe={`${numero(totalCestasFechadas)} de ${numero(totalCestasMeta)} com meta`}
            destaque="emerald"
          />
          <Kpi
            titulo="Gap de faturamento (Real − Meta)"
            valor={dinheiroSinal(comMetaFat.length ? gapCarteira : null)}
            detalhe={`Real ${dinheiro(totalRealFat)} de meta ${dinheiro(totalMetaFat)}`}
            destaque="amber"
          />
          <Kpi
            titulo="Fat. abaixo da meta"
            valor={numero(pdvsFatPendente)}
            detalhe={
              filtrados.length
                ? `${percentual(Math.round((pdvsFatPendente / filtrados.length) * 1000) / 10)} da carteira`
                : "—"
            }
          />
        </section>

        {/* Painel do PDV selecionado (acima da lista para não precisar rolar) */}
        {selecionado && (
          <PainelPdv cliente={selecionado} urlFechar={urlCom(filtros)} />
        )}

        {/* Lista de PDVs */}
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-2 border-b border-slate-200 px-5 py-4">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900">
                Carteira de PDVs
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Ordenado por {ORDENS[filtros.ordem] ?? ORDENS.prioridade}. Clique no cliente para abrir o painel de ação.
              </p>
            </div>
          </div>

          <div className="max-h-[640px] overflow-auto">
            <table className="w-full min-w-[1080px] text-left text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-slate-500 shadow-[0_1px_0_0_rgb(226_232_240)]">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Cliente</th>
                  <th className="px-4 py-2.5 font-semibold">Visita</th>
                  <th className="px-4 py-2.5 font-semibold">GV / Setor</th>
                  <th className="px-4 py-2.5 font-semibold">Faturamento</th>
                  <th className="px-4 py-2.5 font-semibold">Cestas</th>
                  <th className="px-4 py-2.5 text-right font-semibold">SKUs a vender</th>
                  <th className="px-4 py-2.5 font-semibold">Próxima ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtrados.map((c) => {
                  const acao = proximaAcao(c);
                  const ativo = selecionado?.pdv === c.pdv;
                  const href = `${urlCom(filtros, { ver: c.pdv })}#painel`;
                  return (
                    <tr
                      key={c.chave}
                      className={ativo ? "bg-indigo-50/70" : "hover:bg-slate-50"}
                    >
                      <td className="px-4 py-2.5">
                        <Link href={href} className="group block">
                          <p className="font-semibold text-slate-900 group-hover:text-indigo-700 group-hover:underline">
                            {c.nomeFantasia}
                          </p>
                          <p className="text-xs text-slate-500">
                            {c.pdv} · {c.base}
                          </p>
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">{c.visita.replace(/\/$/, "")}</td>
                      <td className="px-4 py-2.5 tabular-nums text-slate-600">
                        {c.gv} / {c.rn}
                      </td>
                      <td className="w-52 px-4 py-2.5">
                        {c.faturamento.status === "SEM_META" ? (
                          <span className="text-xs text-slate-400">Sem meta</span>
                        ) : (
                          <div>
                            <div className="flex justify-between text-xs tabular-nums">
                              <span className="font-semibold text-slate-800">
                                {percentual(c.faturamento.atingimento)}
                              </span>
                              <span
                                className={
                                  (gapFaturamento(c.faturamento) ?? 0) < 0 ? "text-rose-600" : "text-emerald-600"
                                }
                              >
                                {dinheiroSinal(gapFaturamento(c.faturamento))}
                              </span>
                            </div>
                            <div className="mt-1">
                              <Barra valor={c.faturamento.atingimento} status={c.faturamento.status} />
                            </div>
                            <p className="mt-0.5 text-[11px] tabular-nums text-slate-500">
                              Real {dinheiro(c.faturamento.realizado)} / Meta {dinheiro(c.faturamento.meta)}
                            </p>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex gap-1">
                          {c.cestas.map((cesta) => (
                            <span
                              key={cesta.id}
                              title={`${cesta.nome}: ${TEXTO_STATUS[cesta.status]}${
                                cesta.status === "PENDENTE" ? ` (faltam ${cesta.faltam})` : ""
                              }`}
                              className={`h-2.5 w-6 rounded-sm ${
                                cesta.status === "CONCLUIDA"
                                  ? "bg-emerald-500"
                                  : cesta.status === "PENDENTE"
                                    ? "bg-amber-400"
                                    : "bg-slate-200"
                              }`}
                            />
                          ))}
                        </div>
                        <p className="mt-1 text-xs tabular-nums text-slate-500">
                          {c.cestasConcluidas}/{c.cestasComMeta} fechadas
                        </p>
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                        {c.skusFaltantes || <span className="text-slate-300">0</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        <Link
                          href={href}
                          className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-semibold ring-1 ring-inset hover:brightness-95 ${ESTILO_ACAO[acao.tom]}`}
                        >
                          {acao.texto}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {filtrados.length === 0 && (
              <p className="p-10 text-center text-sm text-slate-500">
                Nenhum PDV encontrado para os filtros selecionados.
              </p>
            )}
          </div>
        </section>

        <p className="pb-2 text-center text-xs text-slate-400">
          Score 5 · Inteligência Comercial — dados comerciais de uso interno.
        </p>
      </div>
    </main>
  );
}
