const { network } = require("hardhat");

async function main() {
  const seconds = Number(process.env.SECONDES || 3601); // par defaut : 1 heure + 1 seconde
  await network.provider.send("evm_increaseTime", [seconds]);
  await network.provider.send("evm_mine"); // cree un bloc pour que la nouvelle heure soit prise en compte
  console.log(`Horloge de la blockchain avancee de ${seconds} secondes.`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});