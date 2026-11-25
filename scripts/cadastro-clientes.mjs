// Cadastro de clientes das 8 revendas (dClientes.csv do Power BI): nome fantasia, cidade e bairro.
// Procura em dados/entrada/dClientes.csv e na pasta da rede (Z:\VENDAS\APR\Power BI\Dimensão\dClientes).

import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

// Filial do Promax → código UNB (mesmo código das chaves do Score 5 e do BEES)
export const FILIAL_UNB = {
  "221/0003": "747530", // Patos
  "221/0004": "747548", // Sumé (FL)
  "348/0005": "1036580", // Guarabira
  "064/0001": "487570", // Sousa
  "064/0002": "820288", // Itaporanga
  "361/0006": "1044303", // Brumado
  "361/0007": "1044591", // Barra da Estiva
  "361/0008": "1045180", // Caculé
};

// Código UNB → nome da operação (o mesmo do Score 5 e do BEES)
export const OPERACAO_UNB = {
  "747530": "Pau Brasil Patos",
  "747548": "Pau Brasil FL",
  "487570": "Pau Brasil Sousa",
  "820288": "Pau Brasil FL / Itaporanga",
  "1036580": "Pau Brasil Guarabira",
  "1044303": "Pau Brasil Brumado",
  "1044591": "Pau Brasil Barra da Estiva",
  "1045180": "Pau Brasil Caculé",
};

const LOCAIS = (raiz) => [
  path.join(raiz, "dados", "entrada", "dClientes.csv"),
  "Z:/VENDAS/APR/Power BI/Dimensão/dClientes/dClientes.csv",
];

// Mapa "unb_pdv" → { nome, cidade, bairro }. Sem o arquivo, devolve mapa vazio.
export async function carregarCadastro(raiz) {
  let arquivo = null;
  let maisRecente = 0;
  for (const local of LOCAIS(raiz)) {
    try {
      const info = await fs.stat(local);
      if (info.mtimeMs > maisRecente) {
        arquivo = local;
        maisRecente = info.mtimeMs;
      }
    } catch {
      // local indisponível (ex.: unidade Z: desconectada)
    }
  }
  const mapa = new Map();
  if (!arquivo) {
    console.log("Cadastro dClientes.csv não encontrado — cidade e nome do cadastro ficam vazios.");
    return mapa;
  }

  console.log("Cadastro de clientes:", arquivo);
  const leitor = readline.createInterface({
    input: createReadStream(arquivo, { encoding: "latin1" }),
    crlfDelay: Infinity,
  });
  let cab = null;
  let iPdv, iNome, iCidade, iBairro, iUf, iVisita;
  for await (const linha of leitor) {
    const c = linha.split(";");
    if (!cab) {
      cab = c.map((x) => x.trim());
      iPdv = cab.indexOf("Cód PDV");
      iNome = cab.indexOf("Nome Fantasia");
      iCidade = cab.indexOf("Cidade");
      iBairro = cab.indexOf("Bairro");
      iUf = cab.indexOf("UF");
      iVisita = cab.indexOf("Dia de Visita do VDE");
      if ([iPdv, iNome, iCidade].includes(-1)) {
        throw new Error("dClientes.csv sem as colunas Cód PDV, Nome Fantasia ou Cidade.");
      }
      continue;
    }
    const unb = FILIAL_UNB[`${c[0]?.trim()}/${c[1]?.trim()}`];
    const pdv = c[iPdv]?.trim();
    if (!unb || !pdv) continue;
    mapa.set(`${unb}_${pdv}`, {
      nome: c[iNome]?.trim() ?? "",
      cidade: titulo(c[iCidade]?.trim() ?? ""),
      bairro: titulo(c[iBairro]?.trim() ?? ""),
      uf: c[iUf]?.trim() ?? "",
      visita: iVisita >= 0 ? c[iVisita]?.trim() ?? "" : "", // ex.: "SEG/" ou "SEG/QUI/"
    });
  }
  console.log(`  ${mapa.size} clientes no cadastro`);
  return mapa;
}

// "CAMPINA GRANDE" → "Campina Grande"
function titulo(s) {
  return s
    .toLocaleLowerCase("pt-BR")
    .replace(/(^|\s)(\p{L})/gu, (m, esp, l) => esp + l.toLocaleUpperCase("pt-BR"))
    .replace(/\b(Da|De|Do|Das|Dos|E)\b/g, (p) => p.toLowerCase());
}
