import Link from "next/link";
import {
  type BaseCompradores,
  type Divergencia,
  MOTIVOS_DIVERGENCIA,
  type MotivoDivergencia,
  numero,
  percentual,
  plural,
  regiaoDaOperacao,
} from "@/lib/score5";

// Quadro "Acomp (faturado 03.02.37) × BI Ambev": por RN e por PDV, com o motivo de cada diferença.

type Filtros = { regiao: string; operacao: string; gv: string; setor: string; cidade: string; motivo: string };

const SO_NO_ACOMP: MotivoDivergencia[] = ["balcao", "setorForaBi", "novo", "semVisita", "foraBase", "biNao"];
const LIMITE_PDVS = 400;

const COR_MOTIVO: Record<MotivoDivergencia, string> = {
  balcao: "bg-slate-100 text-slate-700 ring-slate-200",
  setorForaBi: "bg-slate-100 text-slate-700 ring-slate-200",
  novo: "bg-sky-50 text-sky-800 ring-sky-200",
  semVisita: "bg-amber-50 text-amber-800 ring-amber-200",
  foraBase: "bg-orange-50 text-orange-800 ring-orange-200",
  setor: "bg-violet-50 text-violet-800 ring-violet-200",
  biSim: "bg-rose-50 text-rose-800 ring-rose-200",
  biNao: "bg-rose-50 text-rose-800 ring-rose-200",
};

const nomeOperacao = (o: string) => o.replace(/^Pau Brasil /, "");

function dataHora(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", {
    timeZone: "America/Fortaleza",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type LinhaRn = {
  operacao: string;
  setor: string;
  gv: string;
  nome: string;
  acomp: number;
  bi: number;
  soAcomp: number;
  setorEntra: number;
  setorSai: number;
  soBi: number;
  meta: number | null;
};

export function DivergenciaBi({
  base,
  filtros,
  hrefCom,
}: {
  base: BaseCompradores;
  filtros: Filtros;
  hrefCom: (extra: Partial<Filtros>) => string;
}) {
  const bi = base.bi;
  if (!bi) {
    return (
      <section id="divergencia" className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
        Divergência Acomp × BI: o compradores.xlsx do BI da Ambev ainda não foi processado.
      </section>
    );
  }

  const gvDe = (operacao: string, setor: string) => base.rns[`${operacao}|${setor}`]?.gv ?? "";
  // Escopo por operação/GV/RN (a cidade não existe no total por RN do BI: só filtra a lista de PDVs)
  const noEscopo = (operacao: string, setor: string) =>
    (!filtros.regiao || regiaoDaOperacao(operacao) === filtros.regiao) &&
    (!filtros.operacao || operacao === filtros.operacao) &&
    (!filtros.gv || gvDe(operacao, setor) === filtros.gv) &&
    (!filtros.setor || setor === filtros.setor);

  // ---------- Por RN
  const linhas = new Map<string, LinhaRn>();
  const linha = (operacao: string, setor: string) => {
    const k = `${operacao}|${setor}`;
    let l = linhas.get(k);
    if (!l) {
      const rn = base.rns[k];
      l = {
        operacao,
        setor,
        gv: rn?.gv ?? "",
        nome: setor === "0" ? "Balcão / sem RN" : (rn?.nome ?? ""),
        acomp: 0,
        bi: 0,
        soAcomp: 0,
        setorEntra: 0,
        setorSai: 0,
        soBi: 0,
        meta: base.metas[k] ?? null,
      };
      linhas.set(k, l);
    }
    return l;
  };
  for (const c of base.clientes) {
    if (c.situacao !== "nao" && noEscopo(c.operacao, c.setor)) linha(c.operacao, c.setor).acomp++;
  }
  for (const [k, n] of Object.entries(bi.rn)) {
    const [operacao, setor] = k.split("|");
    if (noEscopo(operacao, setor)) linha(operacao, setor).bi += n;
  }
  for (const d of bi.divergencias) {
    if (SO_NO_ACOMP.includes(d.motivo) && noEscopo(d.operacao, d.setorAcomp)) linha(d.operacao, d.setorAcomp).soAcomp++;
    if (d.motivo === "setor") {
      if (noEscopo(d.operacao, d.setorAcomp)) linha(d.operacao, d.setorAcomp).setorEntra++;
      if (noEscopo(d.operacao, d.setorBi)) linha(d.operacao, d.setorBi).setorSai++;
    }
    if (d.motivo === "biSim" && noEscopo(d.operacao, d.setorBi)) linha(d.operacao, d.setorBi).soBi++;
  }
  const todasLinhas = [...linhas.values()];
  const comDiferenca = todasLinhas
    .filter((l) => l.acomp !== l.bi)
    .sort((a, b) => Math.abs(b.acomp - b.bi) - Math.abs(a.acomp - a.bi) || a.setor.localeCompare(b.setor, "pt-BR", { numeric: true }));
  const totalAcomp = todasLinhas.reduce((s, l) => s + l.acomp, 0);
  const totalBi = todasLinhas.reduce((s, l) => s + l.bi, 0);
  const iguais = todasLinhas.filter((l) => l.acomp === l.bi && (l.acomp || l.bi)).length;

  // ---------- Por PDV
  const doEscopo = (d: Divergencia) =>
    (d.setorAcomp && noEscopo(d.operacao, d.setorAcomp)) || (d.setorBi && noEscopo(d.operacao, d.setorBi));
  const divergencias = bi.divergencias.filter((d) => doEscopo(d) && (!filtros.cidade || d.cidade === filtros.cidade));
  const porMotivo = new Map<MotivoDivergencia, number>();
  for (const d of divergencias) porMotivo.set(d.motivo, (porMotivo.get(d.motivo) ?? 0) + 1);
  const motivoAtivo = filtros.motivo as MotivoDivergencia | "";
  const lista = divergencias
    .filter((d) => !motivoAtivo || d.motivo === motivoAtivo)
    .sort(
      (a, b) =>
        a.operacao.localeCompare(b.operacao, "pt-BR") ||
        (a.setorAcomp || a.setorBi).localeCompare(b.setorAcomp || b.setorBi, "pt-BR", { numeric: true }) ||
        a.nome.localeCompare(b.nome, "pt-BR")
    );
  const visiveis = lista.slice(0, LIMITE_PDVS);
  const ancora = (extra: Partial<Filtros>) => `${hrefCom(extra)}#divergencia`;

  return (
    <section id="divergencia" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900">
            Divergência · Acomp (faturado 03.02.37) × BI Ambev
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            PDV a PDV: o acomp conta quem tem nota de venda ou bonificação no mês; o BI (compradores.xlsx, Geo NE)
            conta “Comp. = Sim” na carteira dos RNs.
          </p>
        </div>
        <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
          BI de {dataHora(bi.atualizadoEm)}
          {bi.mes && bi.mes !== base.mes && <span className="ml-1 font-bold text-rose-700">· mês diferente ({bi.mes})</span>}
        </span>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-2 gap-3 border-b border-slate-200 bg-slate-50/60 p-4 md:grid-cols-4">
        <Numero titulo="Acomp" valor={numero(totalAcomp)} detalhe="compradores no faturado" />
        <Numero titulo="BI Ambev" valor={numero(totalBi)} detalhe="compradores no BI" />
        <Numero
          titulo="Diferença"
          valor={`${totalAcomp - totalBi > 0 ? "+" : ""}${numero(totalAcomp - totalBi)}`}
          detalhe={`${percentual(totalBi ? ((totalAcomp - totalBi) / totalBi) * 100 : null)} sobre o BI`}
          cor={totalAcomp === totalBi ? "text-emerald-700" : "text-rose-700"}
        />
        <Numero
          titulo="RNs que batem"
          valor={`${numero(iguais)} de ${numero(todasLinhas.filter((l) => l.acomp || l.bi).length)}`}
          detalhe="mesmo nº de compradores nos dois"
        />
      </div>

      {/* Motivos */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-5 py-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Motivos:</span>
        {(Object.keys(MOTIVOS_DIVERGENCIA) as MotivoDivergencia[])
          .filter((m) => porMotivo.get(m))
          .map((m) => (
            <Link
              key={m}
              href={ancora({ motivo: motivoAtivo === m ? "" : m })}
              title={MOTIVOS_DIVERGENCIA[m].detalhe}
              className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold ring-1 ring-inset ${COR_MOTIVO[m]} ${
                motivoAtivo === m ? "outline outline-2 outline-offset-1 outline-indigo-500" : ""
              }`}
            >
              {MOTIVOS_DIVERGENCIA[m].texto}
              <span className="tabular-nums">{numero(porMotivo.get(m))}</span>
            </Link>
          ))}
        {divergencias.length === 0 && <span className="text-xs text-emerald-700">Nenhuma divergência nos filtros.</span>}
        {motivoAtivo && (
          <Link href={ancora({ motivo: "" })} className="text-xs font-medium text-indigo-700 hover:underline">
            limpar motivo
          </Link>
        )}
      </div>

      {/* Por RN */}
      <div className="max-h-[50vh] overflow-auto border-b border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-slate-500 shadow-[0_1px_0_0_rgb(226_232_240)]">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Operação</th>
              <th className="px-4 py-2.5 font-semibold">RN</th>
              <th className="px-4 py-2.5 text-right font-semibold">Acomp</th>
              <th className="px-4 py-2.5 text-right font-semibold">BI</th>
              <th className="px-4 py-2.5 text-right font-semibold">Diferença</th>
              <th className="px-4 py-2.5 text-right font-semibold" title="Compradores que só o acomp conta">
                Só no acomp
              </th>
              <th className="px-4 py-2.5 text-right font-semibold" title="Entram / saem por setor diferente">
                Setor dif.
              </th>
              <th className="px-4 py-2.5 text-right font-semibold" title="BI conta e o acomp não">
                Só no BI
              </th>
              <th className="px-4 py-2.5 text-right font-semibold">Meta</th>
              <th className="px-4 py-2.5 text-right font-semibold">Falta (BI)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {comDiferenca.map((l) => {
              const dif = l.acomp - l.bi;
              return (
                <tr key={`${l.operacao}|${l.setor}`} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-2 text-slate-600">{nomeOperacao(l.operacao)}</td>
                  <td className="px-4 py-2">
                    <Link
                      href={ancora({ operacao: l.operacao, setor: l.setor, gv: "", motivo: "" })}
                      className="font-semibold text-slate-900 hover:text-indigo-700"
                    >
                      {l.setor === "0" ? l.nome : `${l.setor}${l.nome ? ` · ${l.nome}` : ""}`}
                    </Link>
                    {l.gv && <span className="ml-1.5 text-xs text-slate-400">GV {l.gv}</span>}
                  </td>
                  <td className="px-4 py-2 text-right font-bold tabular-nums">{numero(l.acomp)}</td>
                  <td className="px-4 py-2 text-right font-bold tabular-nums">{numero(l.bi)}</td>
                  <td className={`px-4 py-2 text-right font-bold tabular-nums ${dif > 0 ? "text-rose-700" : "text-amber-700"}`}>
                    {dif > 0 ? "+" : ""}
                    {numero(dif)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-600">{l.soAcomp ? `+${l.soAcomp}` : "—"}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-slate-600">
                    {l.setorEntra || l.setorSai
                      ? [l.setorEntra && `+${l.setorEntra}`, l.setorSai && `−${l.setorSai}`].filter(Boolean).join(" / ")
                      : "—"}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-600">{l.soBi ? `−${l.soBi}` : "—"}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-600">{l.meta !== null ? numero(l.meta) : "—"}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {l.meta === null ? (
                      "—"
                    ) : l.bi >= l.meta ? (
                      <span className="text-xs font-bold text-emerald-700">Bateu</span>
                    ) : (
                      <span className="font-bold text-amber-800">{numero(l.meta - l.bi)}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {comDiferenca.length === 0 && (
          <p className="p-6 text-center text-sm text-emerald-700">Acomp e BI batem em todos os RNs dos filtros.</p>
        )}
      </div>

      {/* Por PDV */}
      <div className="max-h-[60vh] overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-slate-500 shadow-[0_1px_0_0_rgb(226_232_240)]">
            <tr>
              <th className="px-4 py-2.5 font-semibold">PDV</th>
              <th className="px-4 py-2.5 font-semibold">Motivo</th>
              <th className="px-4 py-2.5 text-center font-semibold">Setor no acomp</th>
              <th className="px-4 py-2.5 text-center font-semibold">Setor no BI</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visiveis.map((d) => (
              <tr key={`${d.operacao}|${d.pdv}`}>
                <td className="px-4 py-2 align-top">
                  <p className="font-semibold text-slate-900">{d.nome || `PDV ${d.pdv}`}</p>
                  <p className="text-xs text-slate-500">
                    {d.pdv} · {d.cidade} · {nomeOperacao(d.operacao)}
                  </p>
                </td>
                <td className="px-4 py-2 align-top">
                  <span
                    className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${COR_MOTIVO[d.motivo]}`}
                  >
                    {MOTIVOS_DIVERGENCIA[d.motivo].texto}
                  </span>
                  <p className="mt-0.5 text-[11px] text-slate-400">{MOTIVOS_DIVERGENCIA[d.motivo].detalhe}</p>
                </td>
                <td className="px-4 py-2 text-center align-top tabular-nums text-slate-700">
                  {d.setorAcomp === "0" ? "Balcão" : d.setorAcomp || "não comprou"}
                </td>
                <td className="px-4 py-2 text-center align-top tabular-nums text-slate-700">
                  {d.setorBi || "fora do BI"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {lista.length > LIMITE_PDVS && (
          <p className="border-t border-slate-200 bg-amber-50 p-4 text-center text-sm text-amber-800">
            Mostrando {numero(LIMITE_PDVS)} de {numero(lista.length)} PDVs. Filtre por operação, RN ou motivo.
          </p>
        )}
        {lista.length > 0 && lista.length <= LIMITE_PDVS && (
          <p className="border-t border-slate-100 px-5 py-2 text-xs text-slate-400">
            {plural(lista.length, "PDV divergente", "PDVs divergentes")}
          </p>
        )}
      </div>
    </section>
  );
}

function Numero({ titulo, valor, detalhe, cor }: { titulo: string; valor: string; detalhe: string; cor?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{titulo}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${cor ?? "text-slate-900"}`}>{valor}</p>
      <p className="mt-0.5 text-xs text-slate-500">{detalhe}</p>
    </div>
  );
}
