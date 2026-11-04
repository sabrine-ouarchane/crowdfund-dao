const { ethers, network, artifacts } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const signers = await ethers.getSigners();
  const deployer = signers[0];
  const isLocal = network.name === "localhost" || network.name === "hardhat";

  // Les 3 gardiens du multisig : comptes 1, 2, 3 en local ; variable GUARDIANS sur Sepolia
  const guardians = isLocal
    ? [signers[1].address, signers[2].address, signers[3].address]
    : process.env.GUARDIANS.split(",").map((a) => a.trim());

  // Duree du vote et du timelock (en secondes) : 5 min + 1 min par defaut pour la demo
  const VOTING_PERIOD = Number(process.env.VOTING_PERIOD || 300);
  const EXECUTION_DELAY = Number(process.env.EXECUTION_DELAY || 60);

  console.log(`\nReseau      : ${network.name}`);
  console.log(`Deployeur   : ${deployer.address}`);
  console.log(`Gardiens    : ${guardians.join(", ")}\n`);

  // 1. Deploiement, dans l'ordre
  const token = await (await ethers.getContractFactory("CFDToken")).deploy(deployer.address);
  await token.waitForDeployment();
  console.log(`CFDToken         : ${await token.getAddress()}`);

  const treasury = await (await ethers.getContractFactory("MultiSigTreasury")).deploy(guardians, 2);
  await treasury.waitForDeployment();
  console.log(`MultiSigTreasury : ${await treasury.getAddress()}`);

  const cf = await (await ethers.getContractFactory("Crowdfunding"))
    .deploy(deployer.address, await token.getAddress(), await treasury.getAddress());
  await cf.waitForDeployment();
  console.log(`Crowdfunding     : ${await cf.getAddress()}`);

  const gov = await (await ethers.getContractFactory("Governance"))
    .deploy(await token.getAddress(), await cf.getAddress(), VOTING_PERIOD, EXECUTION_DELAY);
  await gov.waitForDeployment();
  console.log(`Governance       : ${await gov.getAddress()}\n`);

  // 2. Distribution des badges
  await (await token.grantRole(await token.MINTER_ROLE(), await cf.getAddress())).wait();
  await (await treasury.setCore(await cf.getAddress())).wait();
  await (await cf.grantRole(await cf.GOVERNANCE_ROLE(), await gov.getAddress())).wait();

  // 3. Decentralisation : le deployeur renonce aux super-badges (il garde PAUSER_ROLE)
  await (await token.renounceRole(await token.DEFAULT_ADMIN_ROLE(), deployer.address)).wait();
  await (await cf.renounceRole(await cf.DEFAULT_ADMIN_ROLE(), deployer.address)).wait();
    // 4. Verification des badges
  console.log("Verification des roles :");
  console.log(`  Crowdfunding a MINTER_ROLE sur le jeton    : ${await token.hasRole(await token.MINTER_ROLE(), await cf.getAddress())}`);
  console.log(`  Governance a GOVERNANCE_ROLE               : ${await cf.hasRole(await cf.GOVERNANCE_ROLE(), await gov.getAddress())}`);
  console.log(`  Treasury connait Crowdfunding              : ${(await treasury.core()) === (await cf.getAddress())}`);
  console.log(`  Deployeur a PAUSER_ROLE                    : ${await cf.hasRole(await cf.PAUSER_ROLE(), deployer.address)}`);
  console.log(`  Deployeur a encore un super-badge (jeton)  : ${await token.hasRole(await token.DEFAULT_ADMIN_ROLE(), deployer.address)}`);
  console.log(`  Deployeur a encore un super-badge (core)   : ${await cf.hasRole(await cf.DEFAULT_ADMIN_ROLE(), deployer.address)}\n`);

  // 5. Sauvegarde des adresses et des ABI pour le frontend
  const outDir = path.join(__dirname, "..", "frontend", "src", "contracts");
  fs.mkdirSync(outDir, { recursive: true });

  const { chainId } = await ethers.provider.getNetwork();
  const deployment = {
    network: network.name,
    chainId: Number(chainId),
    deployedAt: new Date().toISOString(),
    votingPeriod: VOTING_PERIOD,
    executionDelay: EXECUTION_DELAY,
    guardians,
    contracts: {
      CFDToken: await token.getAddress(),
      MultiSigTreasury: await treasury.getAddress(),
      Crowdfunding: await cf.getAddress(),
      Governance: await gov.getAddress(),
    },
  };
  fs.writeFileSync(path.join(outDir, "deployment.json"), JSON.stringify(deployment, null, 2));

  for (const name of ["CFDToken", "MultiSigTreasury", "Crowdfunding", "Governance"]) {
    const artifact = await artifacts.readArtifact(name);
    fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify({ abi: artifact.abi }, null, 2));
  }
  console.log(`Adresses et ABI sauvegardees dans ${outDir}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});