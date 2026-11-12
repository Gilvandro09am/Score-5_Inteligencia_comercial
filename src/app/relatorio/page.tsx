import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { CampoSelect } from "@/components/CampoSelect";
import {
  acoesPorCesta,
  carregarClientes,
  comparaPrioridade,
  competenciaTexto,
  dataHora,
  dataISO,
  DIAS_SEMANA,
  diaDeHoje,
  diasVisita,
  dinheiro,
  dinheiroSinal,
  gapFaturamento,
  menorGap,
  NOME_DIA,
  numero,
  opcoes,
  percentual,
  plural,
  type Cliente,
} from "@/lib/score5";
import { BotaoPdf } from "./BotaoPdf";

export const metadata: Metadata = {
  title: "Roteiro do GV · Score 5",
  description: "Folha de ação do dia por setor: faturamento, cestas e SKUs com estoque.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function Relatorio({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-slate-100 text-sm text-slate-500">
          Montando relatório…
        </main>
      }
    >
      <ConteudoRelatorio searchParams={searchParams} />
    </Suspense>
  );
}

// ==================================================
// REGRAS DO RELATÓRIO
// ==================================================

/** PDV entra no roteiro quando há algo a fazer: cesta pendente ou faturamento abaixo da meta. */
function temOportunidade(c: Cliente) {
  return c.cestasPendentes > 0 || c.faturamento.status === "PENDENTE";
}

function rotuloGv(gv: string) {
  return gv === "-1" ? "Sem GV" : `GV ${gv}`;
}

function rotuloSetor(rn: string) {
  return rn === "-1" ? "Sem setor" : `Setor ${rn}`;
}

function faltaFaturar(c: Cliente) {
  return c.faturamento.status === "PENDENTE" ? c.faturamento.faltam ?? 0 : 0;
}

type Oferta = { coluna: number; nome: string; codigo?: string; alavanca: number; versao: boolean };

/**
 * Lista única de SKUs a ofertar no PDV, somando todas as cestas pendentes.
 * O mesmo SKU que vale para duas cestas aparece uma vez só (marcado com ★).
 */
function ofertasDoPdv(c: Cliente) {
  const mapa = new Map<number, Oferta>();
  const semEstoque = new Set<string>();

  for (const a of acoesPorCesta(c)) {
    if (a.cesta.status !== "PENDENTE") continue;
    // Só avisa quando a falta de estoque impede fechar a cesta (e ignora "OUTROS", que não é produto)
    if (a.semCobertura > 0) {
      a.bloqueados.filter((b) => !b.startsWith("OUTROS")).forEach((b) => semEstoque.add(b));
    }
    for (const s of a.sugeridos) {
      const atual = mapa.get(s.coluna);
      mapa.set(s.coluna, {
        coluna: s.coluna,
        nome: s.nome,
        codigo: a.comEstoque ? s.itens[0]?.codigo : undefined,
        alavanca: Math.max(atual?.alavanca ?? 0, s.alavanca),
        versao: s.tipo === "VERSAO",
      });
    }
  }

  const ofertas = [...mapa.values()].sort((x, y) => y.alavanca - x.alavanca);
  return { ofertas, semEstoque: [...semEstoque] };
}

// ==================================================
// PÁGINA
// ==================================================

async function ConteudoRelatorio({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  await connection(); // a data de hoje precisa ser lida no momento do pedido
  const agora = new Date();

  const ler = (nome: string) => {
    const v = params[nome];
    return typeof v === "string" ? v.trim() : "";
  };

  const filtros = {
    operacao: ler("operacao"),
    gv: ler("gv"),
    setor: ler("setor"),
    visita: ler("visita") || diaDeHoje(agora),
    todos: ler("todos") === "1",
  };

  const clientes = await carregarClientes();

  // Cascata Operação → GV → Setor (mesma lógica do painel)
  const operacoes = opcoes(clientes.map((c) => c.operacao));
  const porOperacao = clientes.filter((c) => !filtros.operacao || c.operacao === filtros.operacao);
  const gvs = opcoes(porOperacao.map((c) => c.gv));
  const porGv = porOperacao.filter((c) => !filtros.gv || c.gv === filtros.gv);
  const setores = opcoes(porGv.map((c) => c.rn));
  const porSetor = porGv.filter((c) => !filtros.setor || c.rn === filtros.setor);

  const doDia = porSetor.filter((c) =>
    filtros.visita === "TODOS" ? true : diasVisita(c.visita).includes(filtros.visita)
  );
  const lista = filtros.todos ? doDia : doDia.filter(temOportunidade);

  // Ordenado por setor; dentro do setor, PDV mais perto de fechar meta primeiro
  const grupos = opcoes(lista.map((c) => c.rn)).map((rn) => ({
    rn,
    pdvs: lista.filter((c) => c.rn === rn).sort(comparaPrioridade),
    inicio: 0,
  }));
  // Numeração contínua ao longo do relatório
  grupos.reduce((n, g) => ((g.inicio = n), n + g.pdvs.length), 0);

  // Totais do roteiro
  const gapFat = lista.reduce((t, c) => t + faltaFaturar(c), 0);
  const cestasPendentes = lista.reduce((t, c) => t + c.cestasPendentes, 0);
  const fechaRapido = lista.filter((c) => menorGap(c) === 1).length;
  const temEstoque = lista.some((c) => c.unidadeEstoque);

  const nomeDia = filtros.visita === "TODOS" ? "Todos os dias" : NOME_DIA[filtros.visita] ?? filtros.visita;
  const escopo = [
    filtros.operacao ? filtros.operacao.replace(/^Pau Brasil /, "") : "Todas as operações",
    filtros.gv ? rotuloGv(filtros.gv) : "Todos os GVs",
    filtros.setor ? rotuloSetor(filtros.setor) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const nomeArquivo = [
    "Score5",
    filtros.operacao ? filtros.operacao.replace(/^Pau Brasil /, "").replace(/\W+/g, "") : null,
    filtros.gv ? `GV${filtros.gv}` : null,
    filtros.setor ? `Setor${filtros.setor}` : null,
    filtros.visita,
    dataISO(agora),
  ]
    .filter(Boolean)
    .join("_");

  const voltar = new URLSearchParams();
  for (const k of ["operacao", "gv", "setor"] as const) if (filtros[k]) voltar.set(k, filtros[k]);
  if (filtros.visita !== "TODOS") voltar.set("visita", filtros.visita);

  return (
    <main className="min-h-screen bg-slate-200 text-slate-900 print:bg-white">
      {/* Barra de controle — não sai no PDF */}
      <div className="border-b border-slate-300 bg-white print:hidden">
        <form method="GET" className="mx-auto flex max-w-[297mm] flex-wrap items-end gap-3 px-4 py-4">
          <div className="w-44">
            <CampoSelect
              nome="operacao"
              rotulo="Operação"
              valor={filtros.operacao}
              todos="Todas"
              itens={operacoes.map((o) => ({ valor: o, texto: o.replace(/^Pau Brasil /, "") }))}
            />
          </div>
          <div className="w-28">
            <CampoSelect
              nome="gv"
              rotulo="GV"
              valor={filtros.gv}
              itens={gvs.map((g) => ({ valor: g, texto: rotuloGv(g) }))}
            />
          </div>
          <div className="w-28">
            <CampoSelect
              nome="setor"
              rotulo="Setor"
              valor={filtros.setor}
              itens={setores.map((s) => ({ valor: s, texto: s === "-1" ? "Sem setor" : s }))}
            />
          </div>
          <label className="block w-40 text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-600">Dia de visita</span>
            <select
              name="visita"
              defaultValue={filtros.visita}
              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm shadow-sm"
            >
              {DIAS_SEMANA.map((d) => (
                <option key={d} value={d}>
                  {NOME_DIA[d]}
                  {d === diaDeHoje(agora) ? " (hoje)" : ""}
                </option>
              ))}
              <option value="TODOS">Todos os dias</option>
            </select>
          </label>
          <label className="flex h-10 items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" name="todos" value="1" defaultChecked={filtros.todos} />
            Incluir PDVs sem pendência
          </label>
          <button
            type="submit"
            className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            Atualizar
          </button>
          <BotaoPdf nomeArquivo={nomeArquivo} />
          <Link
            href={`/?${voltar.toString()}`}
            className="flex h-10 items-center text-sm font-medium text-indigo-700 hover:underline"
          >
            ← Voltar ao painel
          </Link>
        </form>
      </div>

      {/* Folha A4 paisagem */}
      <div className="mx-auto my-6 max-w-[297mm] bg-white p-[8mm] shadow-lg print:my-0 print:max-w-none print:p-0 print:shadow-none">
        <header className="flex items-end justify-between gap-4 border-b-2 border-slate-900 pb-2">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-indigo-700">
              Score 5 · Inteligência Comercial
            </p>
            <h1 className="text-lg font-extrabold leading-tight text-slate-900">
              Roteiro de oportunidades — {nomeDia}
            </h1>
            <p className="text-[10px] text-slate-600">
              {escopo} · Competência {competenciaTexto(clientes[0]?.competencia)} · Gerado em {dataHora(agora)}
            </p>
          </div>
          <dl className="flex gap-5 text-right">
            {[
              ["PDVs", numero(lista.length)],
              ["Falta faturar", dinheiro(gapFat)],
              ["Cestas pendentes", numero(cestasPendentes)],
              ["Fecham c/ 1 SKU", numero(fechaRapido)],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[8px] font-semibold uppercase tracking-wide text-slate-500">{k}</dt>
                <dd className="text-sm font-bold tabular-nums text-slate-900">{v}</dd>
              </div>
            ))}
          </dl>
        </header>

        {lista.length === 0 ? (
          <p className="mt-10 text-center text-sm text-slate-500">
            Nenhum PDV com oportunidade para {nomeDia.toLowerCase()} neste filtro.
          </p>
        ) : (
          <table className="mt-2 w-full border-collapse text-[10px] leading-tight">
            <thead>
              <tr className="border-b border-slate-400 text-left text-[8px] uppercase tracking-wide text-slate-500">
                <th className="w-[3%] py-1 pr-1 font-semibold">#</th>
                <th className="w-[15%] py-1 pr-2 font-semibold">PDV</th>
                <th className="w-[11%] py-1 pr-2 font-semibold">Faturamento</th>
                <th className="w-[22%] py-1 pr-2 font-semibold">Portfólio ideal (SKUs por cesta)</th>
                <th className="w-[21%] py-1 pr-2 font-semibold">Ofertar {temEstoque ? "(com estoque · cód.)" : ""}</th>
                <th className="w-[28%] py-1 font-semibold">Ação do vendedor (por cesta)</th>
              </tr>
            </thead>

            {grupos.map((g) => (
              <tbody key={g.rn} className="break-inside-avoid-page">
                <tr>
                  <td colSpan={6} className="pt-2">
                    <div className="flex items-baseline justify-between rounded bg-slate-900 px-2 py-1 text-white">
                      <span className="text-[11px] font-bold">{rotuloSetor(g.rn)}</span>
                      <span className="text-[9px] text-slate-300">
                        {plural(g.pdvs.length, "PDV", "PDVs")} · Falta faturar{" "}
                        {dinheiro(g.pdvs.reduce((t, c) => t + faltaFaturar(c), 0))} ·{" "}
                        {plural(g.pdvs.reduce((t, c) => t + c.cestasPendentes, 0), "cesta pendente", "cestas pendentes")}
                      </span>
                    </div>
                  </td>
                </tr>

                {g.pdvs.map((c, i) => {
                  const ordem = g.inicio + i + 1;
                  const fat = c.faturamento;
                  const { ofertas, semEstoque } = ofertasDoPdv(c);
                  const cestas = c.cestas.filter((x) => x.status !== "SEM_META");
                  const acoesCesta = acoesPorCesta(c).filter((a) => a.cesta.status !== "SEM_META");
                  // Cesta a atacar primeiro: a que fecha com menos SKUs e tem estoque para isso
                  const primeira = acoesCesta
                    .filter((a) => a.cesta.status === "PENDENTE" && a.semCobertura === 0)
                    .sort((x, y) => (x.cesta.faltam ?? 0) - (y.cesta.faltam ?? 0))[0]?.cesta.id;

                  return (
                    <tr key={c.chave} className="break-inside-avoid border-b border-slate-200 align-top">
                      <td className="py-1.5 pr-1 tabular-nums text-slate-400">{ordem}</td>

                      <td className="py-1.5 pr-2">
                        <p className="font-bold text-slate-900">{c.nomeFantasia}</p>
                        <p className="text-[8.5px] text-slate-500">
                          {c.pdv} · {c.base}
                        </p>
                      </td>

                      <td className="py-1.5 pr-2 tabular-nums">
                        {fat.status === "PENDENTE" ? (
                          <>
                            <p className="font-bold text-rose-700">Gap {dinheiroSinal(gapFaturamento(fat))}</p>
                            <p className="text-[8.5px] text-slate-500">
                              Real {dinheiro(fat.realizado)} · Meta {dinheiro(fat.meta)} · {percentual(fat.atingimento)}
                            </p>
                          </>
                        ) : fat.status === "CONCLUIDA" ? (
                          <>
                            <p className="font-semibold text-emerald-700">
                              ✓ Gap {dinheiroSinal(gapFaturamento(fat))}
                            </p>
                            <p className="text-[8.5px] text-slate-500">
                              Real {dinheiro(fat.realizado)} · Meta {dinheiro(fat.meta)}
                            </p>
                          </>
                        ) : (
                          <p className="text-slate-400">Sem meta</p>
                        )}
                      </td>

                      <td className="py-1.5 pr-2">
                        {cestas.length === 0 ? (
                          <span className="text-slate-400">Sem meta de cestas</span>
                        ) : (
                          <table className="w-full border-collapse text-[9px] tabular-nums">
                            <thead>
                              <tr className="text-[7.5px] uppercase tracking-wide text-slate-400">
                                <th className="pb-0.5 text-left font-semibold">Cesta</th>
                                <th className="pb-0.5 text-center font-semibold">Meta</th>
                                <th className="pb-0.5 text-center font-semibold">Real</th>
                                <th className="pb-0.5 text-center font-semibold">Falta</th>
                              </tr>
                            </thead>
                            <tbody>
                              {cestas.map((x) => {
                                const fechada = x.status === "CONCLUIDA";
                                return (
                                  <tr key={x.id} className="border-t border-slate-100">
                                    <td className="py-0.5 pr-1 font-semibold text-slate-800">{x.nome}</td>
                                    <td className="py-0.5 text-center text-slate-700">{x.meta}</td>
                                    <td className="py-0.5 text-center text-slate-700">{x.realizado}</td>
                                    <td className="py-0.5 text-center">
                                      {fechada ? (
                                        <span className="rounded bg-emerald-100 px-1 font-bold text-emerald-800">✓ ok</span>
                                      ) : (
                                        <span className="rounded bg-rose-100 px-1.5 font-bold text-rose-700">{x.faltam}</span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                      </td>

                      <td className="py-1.5 pr-2">
                        {ofertas.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {ofertas.map((o) => (
                              <span
                                key={o.coluna}
                                className="whitespace-nowrap rounded border border-slate-300 px-1 py-0.5 text-[9px]"
                              >
                                {o.alavanca > 1 && <span className="text-indigo-700">★ </span>}
                                <span className="font-semibold text-slate-900">
                                  {o.versao ? "+1 " : ""}
                                  {o.nome}
                                </span>
                                {o.codigo && <span className="text-slate-500"> ·{o.codigo}</span>}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                        {semEstoque.length > 0 && (
                          <p className="mt-0.5 text-[8.5px] text-rose-700">
                            Travado por estoque: {semEstoque.join(", ")}
                          </p>
                        )}
                      </td>

                      <td className="py-1.5">
                        <ul className="space-y-0.5 text-[9px] leading-snug">
                          {acoesCesta.map((a) => {
                            const skus = a.sugeridos
                              .map((s) => (s.tipo === "VERSAO" ? `+1 ${s.nome}` : s.nome))
                              .join(", ");
                            return (
                              <li key={a.cesta.id} className="flex gap-1">
                                {a.cesta.id === primeira ? (
                                  <span className="h-fit rounded bg-indigo-600 px-1 text-[8px] font-bold text-white">1º</span>
                                ) : (
                                  <span className="w-[14px] flex-none" />
                                )}
                                <span>
                                  <span className="font-bold text-slate-900">{a.cesta.nome}:</span>{" "}
                                  {a.cesta.status === "CONCLUIDA" ? (
                                    <span className="text-emerald-700">✓ fechada — manter recompra</span>
                                  ) : a.sugeridos.length === 0 ? (
                                    <span className="text-rose-700">
                                      sem estoque para avançar — acionar supervisor
                                    </span>
                                  ) : (
                                    <>
                                      <span className="text-slate-700">
                                        vender {a.sugeridos.length} → {skus}
                                      </span>
                                      {a.semCobertura > 0 && (
                                        <span className="text-rose-700">
                                          {" "}(+{a.semCobertura} sem estoque)
                                        </span>
                                      )}
                                    </>
                                  )}
                                </span>
                              </li>
                            );
                          })}
                          {fat.status === "PENDENTE" && (
                            <li className="flex gap-1">
                              {acoesCesta.length > 0 && !primeira ? (
                                <span className="h-fit rounded bg-indigo-600 px-1 text-[8px] font-bold text-white">1º</span>
                              ) : acoesCesta.length > 0 ? (
                                <span className="w-[14px] flex-none" />
                              ) : null}
                              <span>
                                <span className="font-bold text-slate-900">Faturamento:</span>{" "}
                                <span className="text-slate-700">faturar {dinheiro(fat.faltam)} p/ meta</span>
                              </span>
                            </li>
                          )}
                        </ul>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        )}

        <footer className="mt-3 flex flex-wrap justify-between gap-2 border-t border-slate-200 pt-1.5 text-[8.5px] text-slate-500">
          <span>
            <span className="text-indigo-700">★</span> SKU que conta para 2 cestas · “+1” = nova versão de
            marca já comprada · Falta = SKUs distintos que ainda faltam para fechar a cesta
          </span>
          <span>
            {temEstoque
              ? "Sugestões consideram o saldo da grade de estoque no processamento."
              : "Estoque não integrado para esta unidade — confirmar disponibilidade."}{" "}
            Uso interno.
          </span>
        </footer>
      </div>
    </main>
  );
}
