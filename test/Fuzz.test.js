const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

// Generateur pseudo-aleatoire A GRAINE FIXE : memes valeurs a chaque lancement (resultats reproductibles)
function makeRng(seed) {
  return function () {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = Number(process.env.FUZZ_SEED || 2026);
const RUNS = Number(process.env.FUZZ_RUNS || 25);
const ONE_ETH = 10n ** 18n;
const RATE = 1000n;

// Montant aleatoire en wei, entre 1 wei et maxEth ETH (avec des wei "impairs" pour tester les arrondis)
function randWei(r, maxEth) {
  const micro = BigInt(Math.floor(r() * maxEth * 1_000_000)) + 1n;
  return micro * 10n ** 12n + BigInt(Math.floor(r() * 1000));
}
const randInt = (r, min, max) => min + Math.floor(r() * (max - min + 1));

describe("FUZZING (proprietes testees sur des valeurs aleatoires)", function () {
  this.timeout(300000);

  async function deployFixture() {
    const [admin, gov, g1, g2, g3, amina, ...users] = await ethers.getSigners();
    const token = await (await ethers.getContractFactory("CFDToken")).deploy(admin.address);
    const treasury = await (await ethers.getContractFactory("MultiSigTreasury"))
      .deploy([g1.address, g2.address, g3.address], 2);
    const cf = await (await ethers.getContractFactory("Crowdfunding"))
      .deploy(admin.address, await token.getAddress(), await treasury.getAddress());
    await token.grantRole(await token.MINTER_ROLE(), await cf.getAddress());
    await treasury.setCore(await cf.getAddress());
    await cf.grantRole(await cf.GOVERNANCE_ROLE(), gov.address);
    // Campagne n°0 : objectif tres haut pour qu'elle reste "En cours"
    await cf.connect(amina).createCampaign(1000n * ONE_ETH, 30 * 86400, amina.address, "QmFuzz");
    return { token, treasury, cf, gov, amina, users };
  }

  it(`PROPRIETE 1 : CFD recus = 1000 x ETH contribues (${RUNS} scenarios aleatoires)`, async function () {
    const r = makeRng(SEED);
    for (let run = 0; run < RUNS; run++) {
      const { token, cf, users } = await loadFixture(deployFixture);
      const expected = new Map();
      let total = 0n;

      const n = randInt(r, 1, 8);
      for (let i = 0; i < n; i++) {
        const user = users[randInt(r, 0, users.length - 1)];
        const amount = randWei(r, 20);
        await cf.connect(user).contribute(0, { value: amount });
        expected.set(user, (expected.get(user) || 0n) + amount);
        total += amount;
      }

      for (const [user, sum] of expected) {
        expect(await token.balanceOf(user.address)).to.equal(sum * RATE);
        expect(await token.getVotes(user.address)).to.equal(sum * RATE);
        expect(await cf.contributions(0, user.address)).to.equal(sum);
      }
      expect((await cf.getCampaign(0)).raised).to.equal(total);
      expect(await ethers.provider.getBalance(await cf.getAddress())).to.equal(total);
      expect(await token.totalSupply()).to.equal(total * RATE);
    }
  });

  it(`PROPRIETE 2 : un remboursement ne rend jamais plus que ce qui reste (${RUNS} scenarios)`, async function () {
    const r = makeRng(SEED + 1);
    for (let run = 0; run < RUNS; run++) {
      const { token, cf, gov, amina, users } = await loadFixture(deployFixture);
      const cfAddr = await cf.getAddress();

      // Contributions aleatoires
      const contributed = new Map();
      const n = randInt(r, 1, 8);
      for (let i = 0; i < n; i++) {
        const user = users[randInt(r, 0, users.length - 1)];
        const amount = randWei(r, 15);
        await cf.connect(user).contribute(0, { value: amount });
        contributed.set(user, (contributed.get(user) || 0n) + amount);
      }
      const raised = (await cf.getCampaign(0)).raised;

      // Deblocage anticipe d'un pourcentage aleatoire (0 a 99 %), puis gel
      const withdrawn = (raised * BigInt(randInt(r, 0, 99))) / 100n;
      if (withdrawn > 0n) {
        await cf.connect(gov).approveRelease(0, withdrawn);
        await cf.connect(amina).withdrawFunds(0, withdrawn);
      }
      await cf.connect(gov).freezeCampaign(0);

      // Remboursements dans un ordre aleatoire
      const order = [...contributed.keys()].sort(() => r() - 0.5);
      let refundedTotal = 0n;
      for (const user of order) {
        const before = await ethers.provider.getBalance(cfAddr);
        await cf.connect(user).refund(0);
        const paid = before - (await ethers.provider.getBalance(cfAddr));

        const expectedPaid = (contributed.get(user) * (raised - withdrawn)) / raised;
        expect(paid).to.equal(expectedPaid);              // meme pourcentage pour tous
        expect(paid).to.be.lte(contributed.get(user));    // jamais plus que la mise
        expect(await token.balanceOf(user.address)).to.equal(0n); // CFD brules
        refundedTotal += paid;
      }

      // Le contrat n'a jamais rendu plus que ce qui restait (il ne reste que quelques wei d'arrondi)
      expect(refundedTotal).to.be.lte(raised - withdrawn);
      const dust = await ethers.provider.getBalance(cfAddr);
      expect(dust).to.equal(raised - withdrawn - refundedTotal);
      expect(dust).to.be.lt(BigInt(order.length));
      expect(await token.totalSupply()).to.equal(0n);

      // Un second remboursement est toujours refuse
      await expect(cf.connect(order[0]).refund(0)).to.be.revertedWith("CF: rien a rembourser");
    }
  });

  it(`PROPRIETE 3 : au-dela de 5 ETH cumules, tout retrait passe par le multisig (${RUNS} scenarios)`, async function () {
    const r = makeRng(SEED + 2);
    const THRESHOLD = 5n * ONE_ETH;
    for (let run = 0; run < RUNS; run++) {
      const { treasury, cf, gov, amina, users } = await loadFixture(deployFixture);
      const tAddr = await treasury.getAddress();

      await cf.connect(users[0]).contribute(0, { value: 50n * ONE_ETH });
      await cf.connect(gov).approveRelease(0, 50n * ONE_ETH);

      let withdrawn = 0n;
      let txCount = 0n;
      const steps = randInt(r, 1, 8);
      for (let i = 0; i < steps; i++) {
        const remaining = 50n * ONE_ETH - withdrawn;
        if (remaining === 0n) break;
        let amount = randWei(r, 4);
        if (amount > remaining) amount = remaining;

        const viaMultisig = withdrawn + amount > THRESHOLD;
        const before = await ethers.provider.getBalance(tAddr);
        await cf.connect(amina).withdrawFunds(0, amount);
        const received = (await ethers.provider.getBalance(tAddr)) - before;

        if (viaMultisig) {
          expect(received).to.equal(amount);
          txCount++;
        } else {
          expect(received).to.equal(0n);
        }
        expect(await treasury.transactionCount()).to.equal(txCount);
        withdrawn += amount;
      }

      // On ne peut jamais retirer plus que ce que la DAO a autorise
      await expect(cf.connect(amina).withdrawFunds(0, 50n * ONE_ETH - withdrawn + 1n))
        .to.be.revertedWith("CF: montant non autorise");
    }
  });
});