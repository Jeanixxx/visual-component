import type { ResultType } from "eecircuit-engine";

/**
 * Ejecuta un netlist SPICE con ngspice compilado a WebAssembly, en el navegador.
 * El motor se carga solo la primera vez que se simula (es un archivo de ~20 MB).
 */
export async function runNetlist(netlist: string): Promise<ResultType> {
  const { Simulation } = await import("eecircuit-engine");
  const sim = new Simulation();
  await sim.start();
  sim.setNetList(netlist);
  return sim.runSim();
}
