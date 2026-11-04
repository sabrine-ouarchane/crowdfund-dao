const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Crowdfunding", function () {
  let token, treasury, cf;
  let admin, gov, g1, g2, g3, amina, youssef, salma, karim, mallory;

  const ETH = (n) => ethers.parseEther(n.toString());
  const CFD = (n) => ethers.parseUnits(n.toString(), 18);
  const SEPT_JOURS = 7 * 24 * 3600;
  const Status = { Active: 0n, Successful: 1n, Failed: 2n, Cancelled: 3n };

  beforeEach(async function () {
    [admin, gov, g1, g2, g3, amina, youssef, salma, karim, mallory] = await ethers.getSigners();

    // Deploiement dans le bon ordre : Token -> Treasury -> Crowdfunding
    token = await (await ethers.getContractFactory("CFDToken")).deploy(admin.address);
    treasury = await (await ethers.getContractFactory("MultiSigTreasury"))
      .deploy([g1.address, g2.address, g3.address], 2);
    cf = await (await ethers.getContractFactory("Crowdfunding"))
      .deploy(admin.address, await token.getAddress(), await treasury.getAddress());

    // Distribution des badges
    await token.grantRole(await token.MINTER_ROLE(), await cf.getAddress());
    await treasury.setCore(await cf.getAddress());
    await cf.grantRole(await cf.GOVERNANCE_ROLE(), gov.address); // "gov" simule le contrat Governance
  });

  // Amina cree une campagne : objectif 10 ETH, 7 jours -> campagne n°0
  async function creerCampagne() {
    await cf.connect(amina).createCampaign(ETH(10), SEPT_JOURS, amina.address, "QmTestHash");
  }

  it("cree une campagne avec les bonnes donnees", async function () {
    await creerCampagne();
    const c = await cf.getCampaign(0);
    expect(c.beneficiary).to.equal(amina.address);
    expect(c.goal).to.equal(ETH(10));
    expect(c.status).to.equal(Status.Active);
    expect(c.ipfsHash).to.equal("QmTestHash");
  });

  it("refuse une duree invalide", async function () {
    await expect(cf.connect(amina).createCampaign(ETH(10), 60, amina.address, "Qm"))
      .to.be.revertedWith("CF: duree invalide");
  });

  it("contribuer 4 ETH donne 4 000 CFD", async function () {
    await creerCampagne();
    await cf.connect(youssef).contribute(0, { value: ETH(4) });
    expect(await token.balanceOf(youssef.address)).to.equal(CFD(4000));
    expect((await cf.getCampaign(0)).raised).to.equal(ETH(4));
  });

  it("refuse une contribution apres la date limite", async function () {
    await creerCampagne();
    await time.increase(SEPT_JOURS + 1);
    await expect(cf.connect(youssef).contribute(0, { value: ETH(1) }))
      .to.be.revertedWith("CF: campagne terminee");
  });
    it("finalize : Reussie si l'objectif est atteint", async function () {
    await creerCampagne();
    await cf.connect(youssef).contribute(0, { value: ETH(10) });
    await time.increase(SEPT_JOURS + 1);
    await cf.finalize(0);
    expect((await cf.getCampaign(0)).status).to.equal(Status.Successful);
  });

  it("campagne echouee : remboursement des ETH et burn des CFD", async function () {
    await creerCampagne();
    await cf.connect(youssef).contribute(0, { value: ETH(4) });
    await time.increase(SEPT_JOURS + 1);
    await cf.finalize(0);
    expect((await cf.getCampaign(0)).status).to.equal(Status.Failed);

    await expect(cf.connect(youssef).refund(0))
      .to.changeEtherBalances([youssef, cf], [ETH(4), -ETH(4)]);
    expect(await token.balanceOf(youssef.address)).to.equal(0);
  });

  it("pas de remboursement sur une campagne reussie", async function () {
    await creerCampagne();
    await cf.connect(youssef).contribute(0, { value: ETH(10) });
    await time.increase(SEPT_JOURS + 1);
    await cf.finalize(0);
    await expect(cf.connect(youssef).refund(0))
      .to.be.revertedWith("CF: remboursement impossible");
  });

  it("remboursement proportionnel apres deblocage anticipe puis gel", async function () {
    await creerCampagne();
    await cf.connect(youssef).contribute(0, { value: ETH(4) });
    await cf.connect(salma).contribute(0, { value: ETH(3) });
    await cf.connect(karim).contribute(0, { value: ETH(2) }); // total 9 ETH

    await cf.connect(gov).approveRelease(0, ETH(3));   // la DAO autorise 3 ETH en avance
    await cf.connect(amina).withdrawFunds(0, ETH(3));  // Amina les retire
    await cf.connect(gov).freezeCampaign(0);           // puis la DAO gele la campagne

    // Youssef recupere 4 x (9 - 3) / 9 = 2,666... ETH
    const attendu = (ETH(4) * (ETH(9) - ETH(3))) / ETH(9);
    await expect(cf.connect(youssef).refund(0))
      .to.changeEtherBalance(youssef, attendu);
  });
    it("retrait refuse sans validation de la gouvernance", async function () {
    await creerCampagne();
    await cf.connect(youssef).contribute(0, { value: ETH(4) });
    await expect(cf.connect(amina).withdrawFunds(0, ETH(1)))
      .to.be.revertedWith("CF: montant non autorise");
  });

  it("CONTROLE D'ACCES : seule la gouvernance peut autoriser un retrait", async function () {
    await creerCampagne();
    await cf.connect(youssef).contribute(0, { value: ETH(4) });
    await expect(cf.connect(mallory).approveRelease(0, ETH(4)))
      .to.be.revertedWithCustomError(cf, "AccessControlUnauthorizedAccount");
  });

  it("retrait sous le seuil : envoye directement au beneficiaire", async function () {
    await creerCampagne();
    await cf.connect(youssef).contribute(0, { value: ETH(4) });
    await cf.connect(gov).approveRelease(0, ETH(3));
    await expect(cf.connect(amina).withdrawFunds(0, ETH(3)))
      .to.changeEtherBalance(amina, ETH(3));
  });

  it("ANTI-DECOUPAGE : 3,5 + 3,5 ETH -> le 2e retrait passe par le multisig", async function () {
    await creerCampagne();
    await cf.connect(youssef).contribute(0, { value: ETH(10) });
    await cf.connect(gov).approveRelease(0, ETH(7));

    // 1er retrait : cumul 3,5 <= 5 -> direct
    await expect(cf.connect(amina).withdrawFunds(0, ETH(3.5)))
      .to.changeEtherBalance(amina, ETH(3.5));

    // 2e retrait : cumul 7 > 5 -> vers le multisig, pas vers Amina
    await expect(cf.connect(amina).withdrawFunds(0, ETH(3.5)))
      .to.changeEtherBalances([amina, treasury], [0, ETH(3.5)]);
    expect(await treasury.transactionCount()).to.equal(1);
  });

  it("CIRCUIT BREAKER : la pause bloque les contributions", async function () {
    await creerCampagne();
    await cf.connect(admin).pause();
    await expect(cf.connect(youssef).contribute(0, { value: ETH(1) }))
      .to.be.revertedWithCustomError(cf, "EnforcedPause");

    await cf.connect(admin).unpause();
    await cf.connect(youssef).contribute(0, { value: ETH(1) }); // remarche
  });

  it("CONTROLE D'ACCES : un inconnu ne peut pas mettre en pause", async function () {
    await expect(cf.connect(mallory).pause())
      .to.be.revertedWithCustomError(cf, "AccessControlUnauthorizedAccount");
  });
    it("REENTRANCE : l'attaque sur refund echoue et aucun fonds ne sort", async function () {
    const attacker = await (await ethers.getContractFactory("ReentrancyAttacker"))
      .deploy(await cf.getAddress());

    await creerCampagne();
    await cf.connect(youssef).contribute(0, { value: ETH(4) });
    await attacker.connect(mallory).contributeTo(0, { value: ETH(1) });

    await time.increase(SEPT_JOURS + 1);
    await cf.finalize(0); // 5 ETH < 10 -> Echouee

    // L'attaque est annulee en entier
    await expect(attacker.connect(mallory).attack())
      .to.be.revertedWith("CF: transfert echoue");

    // Les 5 ETH sont toujours dans le contrat
    expect(await ethers.provider.getBalance(await cf.getAddress())).to.equal(ETH(5));

    // Youssef, lui, peut toujours se faire rembourser normalement
    await expect(cf.connect(youssef).refund(0))
      .to.changeEtherBalance(youssef, ETH(4));
  });
});