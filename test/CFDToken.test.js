const { expect } = require("chai");
const { ethers } = require("hardhat");
const { mine } = require("@nomicfoundation/hardhat-network-helpers");

describe("CFDToken", function () {
  let token, admin, minter, youssef, mallory;

  // Convertit un nombre de CFD en unites (1 CFD = 10^18 unites)
  const CFD = (n) => ethers.parseUnits(n.toString(), 18);

  beforeEach(async function () {
    [admin, minter, youssef, mallory] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("CFDToken");
    token = await Token.deploy(admin.address);

    // Ici, "minter" joue le role du futur contrat Crowdfunding
    await token.grantRole(await token.MINTER_ROLE(), minter.address);
  });
    it("a le bon nom et le bon symbole", async function () {
    expect(await token.name()).to.equal("CrowdFund DAO Token");
    expect(await token.symbol()).to.equal("CFD");
  });

  it("le minter peut creer des CFD", async function () {
    await token.connect(minter).mint(youssef.address, CFD(4000));
    expect(await token.balanceOf(youssef.address)).to.equal(CFD(4000));
  });

  it("CONTROLE D'ACCES : un inconnu ne peut pas mint", async function () {
    await expect(
      token.connect(mallory).mint(mallory.address, CFD(1000000))
    ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
  });

  it("CONTROLE D'ACCES : un inconnu ne peut pas burn", async function () {
    await token.connect(minter).mint(youssef.address, CFD(4000));
    await expect(
      token.connect(mallory).burn(youssef.address, CFD(4000))
    ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
  });
    it("auto-delegation : les CFD comptent comme voix des le mint", async function () {
    await token.connect(minter).mint(youssef.address, CFD(4000));
    expect(await token.delegates(youssef.address)).to.equal(youssef.address);
    expect(await token.getVotes(youssef.address)).to.equal(CFD(4000));
  });

  it("burn retire aussi le pouvoir de vote", async function () {
    await token.connect(minter).mint(youssef.address, CFD(4000));
    await token.connect(minter).burn(youssef.address, CFD(4000));
    expect(await token.balanceOf(youssef.address)).to.equal(0);
    expect(await token.getVotes(youssef.address)).to.equal(0);
  });

  it("SNAPSHOT : des CFD recus apres la photo ne comptent pas", async function () {
    // 1. Youssef a des CFD AVANT la proposition
    await token.connect(minter).mint(youssef.address, CFD(4000));
    await mine(1);

    // 2. La gouvernance prend la photo a ce bloc
    const snapshotBlock = (await ethers.provider.getBlockNumber()) - 1;

    // 3. Mallory obtient 20 000 CFD APRES la photo
    await token.connect(minter).mint(mallory.address, CFD(20000));
    await mine(1);

    // 4. Verifications
    expect(await token.getPastVotes(youssef.address, snapshotBlock)).to.equal(CFD(4000));
    expect(await token.getPastVotes(mallory.address, snapshotBlock)).to.equal(0);
    expect(await token.getVotes(mallory.address)).to.equal(CFD(20000));
  });
});