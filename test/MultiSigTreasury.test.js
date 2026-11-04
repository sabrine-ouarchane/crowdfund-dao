const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MultiSigTreasury", function () {
  let treasury, deployer, g1, g2, g3, core, amina, mallory;
  const ETH = (n) => ethers.parseEther(n.toString());

  beforeEach(async function () {
    [deployer, g1, g2, g3, core, amina, mallory] = await ethers.getSigners();

    const Treasury = await ethers.getContractFactory("MultiSigTreasury");
    treasury = await Treasury.deploy([g1.address, g2.address, g3.address], 2);

    // Ici, le compte "core" joue le role du futur contrat Crowdfunding
    await treasury.setCore(core.address);
  });

  // Fonction d'aide : Crowdfunding depose 7 ETH destines a Amina -> transaction n°0
  async function deposerPourAmina() {
    await treasury.connect(core).deposit(amina.address, { value: ETH(7) });
  }

  it("refuse moins de 3 signataires", async function () {
    const Treasury = await ethers.getContractFactory("MultiSigTreasury");
    await expect(Treasury.deploy([g1.address, g2.address], 2))
      .to.be.revertedWith("MS: au moins 3 signataires");
  });

  it("refuse un signataire en double", async function () {
    const Treasury = await ethers.getContractFactory("MultiSigTreasury");
    await expect(Treasury.deploy([g1.address, g1.address, g2.address], 2))
      .to.be.revertedWith("MS: signataire en double");
  });

  it("setCore ne peut etre appele qu'une seule fois", async function () {
    await expect(treasury.setCore(mallory.address))
      .to.be.revertedWith("MS: core deja defini");
  });

  it("seul Crowdfunding peut deposer", async function () {
    await expect(treasury.connect(mallory).deposit(mallory.address, { value: ETH(1) }))
      .to.be.revertedWith("MS: seul Crowdfunding");
  });
    it("1 signature ne suffit pas", async function () {
    await deposerPourAmina();
    await treasury.connect(g1).confirm(0);
    await expect(treasury.connect(g1).execute(0))
      .to.be.revertedWith("MS: pas assez de signatures");
  });

  it("2 signatures sur 3 : Amina recoit les 7 ETH", async function () {
    await deposerPourAmina();
    await treasury.connect(g1).confirm(0);
    await treasury.connect(g2).confirm(0);

    await expect(treasury.connect(g1).execute(0))
      .to.changeEtherBalances([amina, treasury], [ETH(7), -ETH(7)]);
  });

  it("un gardien ne peut pas signer deux fois", async function () {
    await deposerPourAmina();
    await treasury.connect(g1).confirm(0);
    await expect(treasury.connect(g1).confirm(0))
      .to.be.revertedWith("MS: deja confirme");
  });

  it("un inconnu ne peut pas signer", async function () {
    await deposerPourAmina();
    await expect(treasury.connect(mallory).confirm(0))
      .to.be.revertedWith("MS: pas signataire");
  });

  it("revoke retire une signature", async function () {
    await deposerPourAmina();
    await treasury.connect(g1).confirm(0);
    await treasury.connect(g2).confirm(0);
    await treasury.connect(g2).revoke(0);

    await expect(treasury.connect(g1).execute(0))
      .to.be.revertedWith("MS: pas assez de signatures");
  });

  it("une transaction ne peut pas etre payee deux fois", async function () {
    await deposerPourAmina();
    await treasury.connect(g1).confirm(0);
    await treasury.connect(g2).confirm(0);
    await treasury.connect(g1).execute(0);

    await expect(treasury.connect(g2).execute(0))
      .to.be.revertedWith("MS: deja executee");
  });
});