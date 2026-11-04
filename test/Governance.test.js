const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Governance", function () {
  let token, treasury, cf, gov;
  let admin, g1, g2, g3, amina, youssef, salma, karim, mallory, gros;

  const ETH = (n) => ethers.parseEther(n.toString());
  const JOUR = 24 * 3600;
  const VOTE = 3 * JOUR;   // periode de vote
  const DELAI = 1 * JOUR;  // timelock
  const Type = { Release: 0, Freeze: 1 };
  const Etat = { Active: 0n, Defeated: 1n, Queued: 2n, Executable: 3n, Executed: 4n, Expired: 5n };

  beforeEach(async function () {
    [admin, g1, g2, g3, amina, youssef, salma, karim, mallory, gros] = await ethers.getSigners();

    // Deploiement complet : Token -> Treasury -> Crowdfunding -> Governance
    token = await (await ethers.getContractFactory("CFDToken")).deploy(admin.address);
    treasury = await (await ethers.getContractFactory("MultiSigTreasury"))
      .deploy([g1.address, g2.address, g3.address], 2);
    cf = await (await ethers.getContractFactory("Crowdfunding"))
      .deploy(admin.address, await token.getAddress(), await treasury.getAddress());
    gov = await (await ethers.getContractFactory("Governance"))
      .deploy(await token.getAddress(), await cf.getAddress(), VOTE, DELAI);

    // Badges : cette fois c'est le VRAI contrat Governance qui recoit GOVERNANCE_ROLE
    await token.grantRole(await token.MINTER_ROLE(), await cf.getAddress());
    await treasury.setCore(await cf.getAddress());
    await cf.grantRole(await cf.GOVERNANCE_ROLE(), await gov.getAddress());

    // Scenario : campagne d'Amina (10 ETH, 30 jours) + 3 contributeurs = 9 000 CFD
    await cf.connect(amina).createCampaign(ETH(10), 30 * JOUR, amina.address, "QmPanneauxSolaires");
    await cf.connect(youssef).contribute(0, { value: ETH(4) });
    await cf.connect(salma).contribute(0, { value: ETH(3) });
    await cf.connect(karim).contribute(0, { value: ETH(2) });
  });

  // Amina demande 3 ETH en avance -> proposition n°0
  async function aminaPropose() {
    await gov.connect(amina).propose(Type.Release, 0, ETH(3), "Achat anticipe des panneaux");
  }

  it("le beneficiaire peut proposer un Release meme sans CFD", async function () {
    await aminaPropose();
    expect(await gov.proposalCount()).to.equal(1);
    expect(await gov.state(0)).to.equal(Etat.Active);
  });

  it("un inconnu sans CFD ne peut pas proposer (anti-spam)", async function () {
    await expect(gov.connect(mallory).propose(Type.Freeze, 0, 0, "Gel abusif"))
      .to.be.revertedWith("GOV: pas assez de CFD pour proposer");
  });
    it("SCENARIO COMPLET : vote, timelock, execution, retrait d'Amina", async function () {
    await aminaPropose();

    await gov.connect(youssef).vote(0, true);   // 4 000 OUI
    await gov.connect(salma).vote(0, true);     // 3 000 OUI
    await gov.connect(karim).vote(0, false);    // 2 000 NON

    const p = await gov.getProposal(0);
    expect(p.forVotes).to.equal(ETH(7000));     // CFD et ETH ont 18 decimales
    expect(p.againstVotes).to.equal(ETH(2000));

    // Fin du vote -> en attente (timelock)
    await time.increase(VOTE + 1);
    expect(await gov.state(0)).to.equal(Etat.Queued);
    await expect(gov.execute(0)).to.be.revertedWith("GOV: non executable");

    // Fin du timelock -> n'importe qui peut executer
    await time.increase(DELAI + 1);
    await gov.connect(mallory).execute(0);
    expect(await gov.state(0)).to.equal(Etat.Executed);
    expect((await cf.getCampaign(0)).approved).to.equal(ETH(3));

    // Amina peut retirer ses 3 ETH
    await expect(cf.connect(amina).withdrawFunds(0, ETH(3)))
      .to.changeEtherBalance(amina, ETH(3));
  });

  it("ANTI-MANIPULATION : Mallory obtient 20 000 CFD apres le snapshot -> 0 voix", async function () {
    await aminaPropose();

    // Mallory contribue massivement APRES la creation de la proposition
    await cf.connect(mallory).contribute(0, { value: ETH(20) });
    expect(await token.balanceOf(mallory.address)).to.equal(ETH(20000));

    // ... mais son vote est refuse : elle n'avait rien au moment de la photo
    await expect(gov.connect(mallory).vote(0, false))
      .to.be.revertedWith("GOV: aucune voix au snapshot");
  });

  it("un votant ne peut pas voter deux fois", async function () {
    await aminaPropose();
    await gov.connect(youssef).vote(0, true);
    await expect(gov.connect(youssef).vote(0, true))
      .to.be.revertedWith("GOV: deja vote");
  });

  it("impossible de voter apres la fin du vote", async function () {
    await aminaPropose();
    await time.increase(VOTE + 1);
    await expect(gov.connect(youssef).vote(0, true))
      .to.be.revertedWith("GOV: vote termine");
  });
    it("QUORUM : moins de 20 % de participation -> rejetee", async function () {
    await cf.connect(gros).contribute(0, { value: ETH(11) });  // total : 20 000 CFD
    await aminaPropose();

    await gov.connect(karim).vote(0, true);  // 2 000 / 20 000 = 10 % < 20 %
    await time.increase(VOTE + DELAI + 1);
    expect(await gov.state(0)).to.equal(Etat.Defeated);
    await expect(gov.execute(0)).to.be.revertedWith("GOV: non executable");
  });

  it("MAJORITE : plus de NON que de OUI -> rejetee", async function () {
    await aminaPropose();
    await gov.connect(youssef).vote(0, false);  // 4 000 NON
    await gov.connect(salma).vote(0, true);     // 3 000 OUI
    await time.increase(VOTE + DELAI + 1);
    expect(await gov.state(0)).to.equal(Etat.Defeated);
  });

  it("GEL : la DAO gele une campagne suspecte -> remboursements ouverts", async function () {
    await gov.connect(youssef).propose(Type.Freeze, 0, 0, "Campagne suspecte");
    await gov.connect(youssef).vote(0, true);
    await gov.connect(salma).vote(0, true);
    await time.increase(VOTE + DELAI + 1);
    await gov.execute(0);

    expect((await cf.getCampaign(0)).status).to.equal(3n);  // Cancelled
    await expect(cf.connect(karim).refund(0))
      .to.changeEtherBalance(karim, ETH(2));
  });

  it("EXPIRATION : une proposition non executee expire apres 7 jours", async function () {
    await aminaPropose();
    await gov.connect(youssef).vote(0, true);
    await time.increase(VOTE + DELAI + 7 * JOUR + 1);
    expect(await gov.state(0)).to.equal(Etat.Expired);
    await expect(gov.execute(0)).to.be.revertedWith("GOV: non executable");
  });

  it("DECENTRALISATION : apres renonciation, l'admin ne peut plus contourner la DAO", async function () {
    await cf.connect(admin).renounceRole(await cf.DEFAULT_ADMIN_ROLE(), admin.address);

    // L'admin ne peut plus se donner le badge de gouvernance...
    await expect(cf.connect(admin).grantRole(await cf.GOVERNANCE_ROLE(), admin.address))
      .to.be.revertedWithCustomError(cf, "AccessControlUnauthorizedAccount");

    // ... mais il peut toujours mettre en pause en cas d'urgence
    await cf.connect(admin).pause();
    expect(await cf.paused()).to.equal(true);
  });
});