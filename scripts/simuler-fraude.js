const { ethers, network } = require("hardhat");
const deployment = require("../frontend/src/contracts/deployment.json");

// Cree de l'activite NORMALE et de l'activite FRAUDULEUSE sur la blockchain locale,
// pour tester le script Python de detection d'anomalies.
async function main() {
  if (network.name !== "localhost") throw new Error("A lancer uniquement avec --network localhost");
  const s = await ethers.getSigners();
  const [amina, youssef, salma, karim, mallory] = [s[4], s[5], s[6], s[7], s[8]];
  const cf = await ethers.getContractAt("Crowdfunding", deployment.contracts.Crowdfunding);
  const DAY = 86400;

  // 1. Campagne normale : montants varies, espaces de 2 heures
  await (await cf.connect(amina).createCampaign(ethers.parseEther("10"), 7 * DAY, amina.address, "demo:Ecole numerique (normale)")).wait();
  const idNormal = Number(await cf.campaignCount()) - 1;
  const normal = [[youssef, "1.2"], [salma, "0.75"], [karim, "2.1"], [youssef, "0.4"], [salma, "1.05"]];
  for (const [who, amount] of normal) {
    await (await cf.connect(who).contribute(idNormal, { value: ethers.parseEther(amount) })).wait();
    await network.provider.send("evm_increaseTime", [2 * 3600]);
    await network.provider.send("evm_mine");
  }
  console.log(`Campagne #${idNormal} (normale) : 5 contributions variees, espacees de 2 h`);

  // 2. Campagne suspecte : Mallory finance 6 faux comptes qui contribuent tous 0,5 ETH en quelques secondes
  await (await cf.connect(mallory).createCampaign(ethers.parseEther("5"), 7 * DAY, mallory.address, "demo:Campagne C (suspecte)")).wait();
  const idSus = Number(await cf.campaignCount()) - 1;
  const fakes = [];
  for (let i = 0; i < 6; i++) {
    const wallet = ethers.Wallet.createRandom().connect(ethers.provider);
    await (await mallory.sendTransaction({ to: wallet.address, value: ethers.parseEther("1") })).wait();
    fakes.push(wallet);
  }
  for (const wallet of fakes) {
    await (await cf.connect(wallet).contribute(idSus, { value: ethers.parseEther("0.5") })).wait();
  }
  console.log(`Campagne #${idSus} (suspecte) : Mallory a finance 6 faux comptes -> 6 x 0,5 ETH en quelques secondes`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});