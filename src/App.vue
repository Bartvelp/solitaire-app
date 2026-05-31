<template>
  <main
    class="game"
    :class="{ redealing: isRedealing }"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="cancelDrag"
  >
    <header class="top-row">
      <section class="foundation-row" aria-label="Foundations">
        <div
          v-for="suit in suits"
          :key="suit"
          class="slot foundation-slot"
          :class="{ highlight: dropTarget === `foundation-${suit}` }"
          :data-zone="`foundation-${suit}`"
        >
          <span v-if="!visibleFoundationCard(suit)" class="slot-mark" :class="suitColor(suit)">
            {{ suit }}
          </span>
          <playing-card
            v-else
            :card="visibleFoundationCard(suit)"
            :style="cardStyle(0)"
            :class="cardClasses(visibleFoundationCard(suit))"
            @pointerdown.stop.prevent="startDrag($event, 'foundation', suit, foundations[suit].length - 1)"
            @tap="tapCard('foundation', suit, foundations[suit].length - 1)"
          />
        </div>
      </section>

      <section class="draw-row" aria-label="Deck">
        <div class="slot waste-slot" data-zone="waste">
          <playing-card
            v-if="visibleWasteCard"
            :card="visibleWasteCard"
            :style="cardStyle(0)"
            :class="cardClasses(visibleWasteCard)"
            @pointerdown.stop.prevent="startDrag($event, 'waste', 'waste', waste.length - 1)"
            @tap="tapCard('waste', 'waste', waste.length - 1)"
          />
        </div>

        <button
          class="slot stock-slot"
          :class="{ 'stock-hidden': isStockAnimating }"
          type="button"
          aria-label="Draw from deck"
          data-zone="stock"
          @click="drawFromStock"
        >
          <span v-if="stock.length" class="card-back small-back"></span>
          <span v-else class="recycle">↻</span>
          <strong>{{ stock.length }}</strong>
        </button>
      </section>
    </header>

    <section class="tableau" aria-label="Tableau">
      <div
        v-for="(pile, pileIndex) in tableau"
        :key="pileIndex"
        class="tableau-pile"
        :class="{ highlight: dropTarget === `tableau-${pileIndex}` }"
        :data-zone="`tableau-${pileIndex}`"
      >
        <transition-group name="card-move" tag="div" class="pile-stack">
          <playing-card
            v-for="(card, cardIndex) in pile"
            :key="card.id"
            :card="card"
            :style="cardStyle(cardIndex)"
            :class="cardClasses(card)"
            @pointerdown.stop.prevent="startDrag($event, 'tableau', pileIndex, cardIndex)"
            @tap="tapCard('tableau', pileIndex, cardIndex)"
          />
        </transition-group>
      </div>
    </section>

    <div v-if="dragState" class="drag-ghost" :style="ghostStyle">
      <playing-card
        v-for="(card, index) in dragState.cards"
        :key="card.id"
        :card="card"
        :style="cardStyle(index)"
      />
    </div>

    <div
      v-for="card in flyingCards"
      :key="card.flyId"
      class="flying-card"
      :class="[{ active: card.active }, card.className]"
      :style="flyingCardStyle(card)"
    >
      <playing-card :card="card.card" :style="{ transform: 'none' }" />
    </div>

    <button
      v-if="canAutoComplete"
      class="auto-complete"
      type="button"
      :disabled="isBusy"
      @click="autoComplete"
    >
      Finish
    </button>

    <button class="undo-button" type="button" :disabled="!history.length || isBusy" @click="undoMove" aria-label="Undo move">
      <span aria-hidden="true">↶</span>
    </button>

    <button v-if="isLocalhost" class="test-button" type="button" :disabled="isBusy" @click="prepareTestFinish">Test</button>

    <button class="new-game" type="button" :disabled="isBusy" @click="newGame">New</button>

    <p v-if="isWon" class="win-banner">You won</p>
    <div v-if="isCalculatingDeal" class="loading-overlay" role="status" aria-live="polite">
      <div class="loading-emblem" aria-hidden="true">
        <span></span>
        <span></span>
        <span></span>
      </div>
      <p class="loading-title">Finding a solvable deal</p>
      <p class="loading-detail">Tried {{ dealAttempts }} random {{ dealAttempts === 1 ? 'shuffle' : 'shuffles' }}</p>
      <p class="loading-fact">{{ loadingFact }}</p>
    </div>
    <div v-if="winBurst" class="win-burst" aria-hidden="true">
      <span v-for="spark in winSparks" :key="spark" :style="winSparkStyle(spark - 1)"></span>
    </div>
  </main>
</template>

<script>
import { h, nextTick } from 'vue';
import { ROMAN_FACTS } from './romanFacts.js';

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const FLIGHT_DURATION = 320;
const DEAL_DURATION = 520;
const NEW_GAME_CLEAR_DURATION = 380;
const SOLVER_NODE_LIMIT = 12000;
const FACT_INTERVAL = 2800;

const PlayingCard = {
  name: 'PlayingCard',
  props: {
    card: {
      type: Object,
      required: true,
    },
  },
  emits: ['tap'],
  methods: {
    suitColor(suit) {
      return suit === '♥' || suit === '♦' ? 'red' : 'black';
    },
  },
  render() {
    const faceClass = this.card.faceUp ? ['faceup', this.suitColor(this.card.suit)] : ['facedown'];
    const inheritedClass = this.$attrs.class;

    return h(
      'button',
      {
        ...this.$attrs,
        class: ['card', faceClass, inheritedClass],
        type: 'button',
        'data-card-id': this.card.id,
        'aria-label': this.card.faceUp ? `${this.card.rank} of ${this.card.suit}` : 'Face down card',
        onClick: (event) => {
          event.stopPropagation();
          this.$emit('tap');
        },
      },
      this.card.faceUp
        ? [
            h('span', { class: 'card-face' }, [
              h('span', { class: 'corner top' }, [this.card.rank, h('small', this.card.suit)]),
              h('span', { class: 'center-suit' }, this.card.suit),
              h('span', { class: 'corner bottom' }, [this.card.rank, h('small', this.card.suit)]),
            ]),
          ]
        : [h('span', { class: 'card-back' })]
    );
  },
};

export default {
  name: 'App',
  components: {
    PlayingCard,
  },
  data() {
    return {
      suits: SUITS,
      stock: [],
      waste: [],
      foundations: {
        '♠': [],
        '♥': [],
        '♦': [],
        '♣': [],
      },
      tableau: [[], [], [], [], [], [], []],
      history: [],
      dragState: null,
      dropTarget: null,
      flyingCards: [],
      animatingCardIds: [],
      isDealing: false,
      isRedealing: false,
      isCalculatingDeal: false,
      isAutoCompleting: false,
      dealAttempts: 0,
      factIndex: Math.floor(Math.random() * ROMAN_FACTS.length),
      factTimer: null,
      winBurst: false,
      winSparks: Array.from({ length: 28 }, (_, index) => index + 1),
    };
  },
  computed: {
    ghostStyle() {
      if (!this.dragState) return {};
      return {
        transform: `translate3d(${this.dragState.x}px, ${this.dragState.y}px, 0)`,
      };
    },
    isWon() {
      return SUITS.every((suit) => this.foundations[suit].length === 13);
    },
    isBusy() {
      return this.isDealing || this.isAutoCompleting || !!this.flyingCards.length;
    },
    canAutoComplete() {
      return !this.isWon && !this.isBusy && this.findAutoCompletePlan().length > 0;
    },
    isLocalhost() {
      return ['localhost', '127.0.0.1', '0.0.0.0'].includes(window.location.hostname);
    },
    isStockAnimating() {
      return this.stock.some((card) => this.animatingCardIds.includes(card.id));
    },
    loadingFact() {
      return ROMAN_FACTS[this.factIndex % ROMAN_FACTS.length];
    },
    visibleWasteCard() {
      for (let i = this.waste.length - 1; i >= 0; i -= 1) {
        const card = this.waste[i];
        if (!this.animatingCardIds.includes(card.id)) return card;
      }

      return null;
    },
  },
  mounted() {
    this.newGame({ animate: false });
  },
  beforeUnmount() {
    this.stopFactRotation();
  },
  methods: {
    async newGame(options = {}) {
      if (this.isDealing || this.isAutoCompleting) return;

      const shouldAnimate = options.animate !== false;
      this.cancelDrag();
      this.winBurst = false;
      this.isDealing = true;
      this.flyingCards = [];
      this.animatingCardIds = [];

      if (shouldAnimate) {
        this.isRedealing = true;
        await this.sleep(NEW_GAME_CLEAR_DURATION);
      }

      const deal = await this.createSolvableDeal();
      this.stock = deal.stock;
      this.waste = [];
      this.foundations = { '♠': [], '♥': [], '♦': [], '♣': [] };
      this.tableau = deal.tableau;
      this.history = [];
      this.cancelDrag();
      this.flyingCards = [];
      this.animatingCardIds = [];

      if (shouldAnimate) {
        await nextTick();
        this.isRedealing = false;
        await this.sleep(DEAL_DURATION);
      }

      this.isDealing = false;
    },
    createDeck() {
      return SUITS.flatMap((suit) =>
        RANKS.map((rank, index) => ({
          id: `${rank}${suit}`,
          suit,
          rank,
          value: index + 1,
          faceUp: false,
        }))
      );
    },
    visibleFoundationCard(suit) {
      const pile = this.foundations[suit];

      for (let i = pile.length - 1; i >= 0; i -= 1) {
        const card = pile[i];
        if (!this.animatingCardIds.includes(card.id)) return card;
      }

      return null;
    },
    async createSolvableDeal() {
      this.isCalculatingDeal = true;
      this.dealAttempts = 0;
      this.startFactRotation();

      try {
        for (let attempt = 0; ; attempt += 1) {
          const deal = this.createRandomDeal();
          this.dealAttempts = attempt + 1;

          if (this.isDealSolvable(deal)) return deal;
          if (attempt % 8 === 7) await this.sleep(0);
        }
      } finally {
        this.isCalculatingDeal = false;
        this.stopFactRotation();
      }
    },
    startFactRotation() {
      this.stopFactRotation();
      this.factIndex = Math.floor(Math.random() * ROMAN_FACTS.length);
      this.factTimer = window.setInterval(() => {
        this.factIndex = (this.factIndex + 1 + Math.floor(Math.random() * 7)) % ROMAN_FACTS.length;
      }, FACT_INTERVAL);
    },
    stopFactRotation() {
      if (!this.factTimer) return;
      window.clearInterval(this.factTimer);
      this.factTimer = null;
    },
    createRandomDeal() {
      const deck = this.shuffle(this.createDeck());
      const tableau = [[], [], [], [], [], [], []];

      for (let pile = 0; pile < 7; pile += 1) {
        for (let cardIndex = 0; cardIndex <= pile; cardIndex += 1) {
          const card = deck.pop();
          card.faceUp = cardIndex === pile;
          tableau[pile].push(card);
        }
      }

      return {
        stock: deck.map((card) => ({ ...card, faceUp: false })),
        tableau,
      };
    },
    shuffle(cards) {
      const copy = [...cards];
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    },
    snapshot() {
      return JSON.parse(
        JSON.stringify({
          stock: this.stock,
          waste: this.waste,
          foundations: this.foundations,
          tableau: this.tableau,
        })
      );
    },
    restore(snapshot) {
      this.stock = snapshot.stock;
      this.waste = snapshot.waste;
      this.foundations = snapshot.foundations;
      this.tableau = snapshot.tableau;
      this.cancelDrag();
    },
    saveHistory() {
      this.history.push(this.snapshot());
    },
    undoMove() {
      if (this.isBusy) return;

      const previous = this.history.pop();
      if (previous) this.restore(previous);
    },
    drawFromStock() {
      if (this.isBusy) return;

      this.saveHistory();
      if (this.stock.length) {
        const card = this.stock.pop();
        card.faceUp = true;
        const flight = this.createStockFlight(card);
        this.startFlight([card], flight);
        this.waste.push(card);
        return;
      }

      if (!this.waste.length) {
        this.history.pop();
        return;
      }

      this.stock = this.waste.reverse().map((card) => ({ ...card, faceUp: false }));
      this.waste = [];
    },
    tapCard(sourceType, sourceKey, cardIndex) {
      if (this.dragState || this.isBusy) return;

      if (sourceType === 'tableau') {
        const pile = this.tableau[sourceKey];
        const card = pile[cardIndex];
        if (!card) return;

        if (!card.faceUp && cardIndex === pile.length - 1) {
          this.saveHistory();
          card.faceUp = true;
          return;
        }

        if (!card.faceUp) return;
      }

      const source = { type: sourceType, key: sourceKey, index: cardIndex };
      const cards = this.cardsFromSource(source);
      if (!cards.length) return;

      const destination = this.findTapDestination(source, cards);
      if (destination) this.animateTapMove(source, destination, cards);
    },
    findTapDestination(source, cards) {
      if (cards.length === 1) {
        const foundation = this.foundationDestination(cards[0]);
        if (foundation) return foundation;
      }

      for (let i = 0; i < this.tableau.length; i += 1) {
        const destination = { type: 'tableau', key: i };
        if (this.isSameLocation(source, destination)) continue;
        if (this.canMoveToTableau(cards, i)) return destination;
      }

      return null;
    },
    foundationDestination(card) {
      return this.canMoveToFoundation(card, card.suit) ? { type: 'foundation', key: card.suit } : null;
    },
    startDrag(event, sourceType, sourceKey, cardIndex) {
      if (this.isBusy) return;

      const source = { type: sourceType, key: sourceKey, index: cardIndex };
      const cards = this.cardsFromSource(source);
      if (!cards.length || !cards[0].faceUp) return;

      const rect = event.currentTarget.getBoundingClientRect();
      this.dragState = {
        source,
        cards,
        cardIds: cards.map((card) => card.id),
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        x: rect.left,
        y: rect.top,
        pointerId: event.pointerId,
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    onPointerMove(event) {
      if (!this.dragState) return;
      this.dragState.x = event.clientX - this.dragState.offsetX;
      this.dragState.y = event.clientY - this.dragState.offsetY;
      this.dropTarget = this.zoneFromPoint(event.clientX, event.clientY);
    },
    onPointerUp(event) {
      if (!this.dragState) return;
      const zone = this.zoneFromPoint(event.clientX, event.clientY);
      const destination = this.destinationFromZone(zone);

      if (destination && this.canMove(this.dragState.source, destination, this.dragState.cards)) {
        this.applyMove(this.dragState.source, destination, this.dragState.cards.length);
      }

      this.cancelDrag();
    },
    cancelDrag() {
      this.dragState = null;
      this.dropTarget = null;
    },
    zoneFromPoint(x, y) {
      const ghost = document.querySelector('.drag-ghost');
      ghost?.classList.add('ghost-hidden');
      const element = document.elementFromPoint(x, y);
      ghost?.classList.remove('ghost-hidden');
      return element?.closest('[data-zone]')?.dataset.zone || null;
    },
    destinationFromZone(zone) {
      if (!zone) return null;
      if (zone.startsWith('foundation-')) return { type: 'foundation', key: zone.replace('foundation-', '') };
      if (zone.startsWith('tableau-')) return { type: 'tableau', key: Number(zone.replace('tableau-', '')) };
      return null;
    },
    cardsFromSource(source) {
      if (source.type === 'waste') {
        return source.index === this.waste.length - 1 ? [this.waste[source.index]] : [];
      }

      if (source.type === 'foundation') {
        const pile = this.foundations[source.key];
        return source.index === pile.length - 1 ? [pile[source.index]] : [];
      }

      const pile = this.tableau[source.key];
      const cards = pile.slice(source.index);
      return this.isValidRun(cards) ? cards : [];
    },
    canMove(source, destination, cards) {
      if (this.isSameLocation(source, destination)) return false;
      if (destination.type === 'foundation') {
        return cards.length === 1 && this.canMoveToFoundation(cards[0], destination.key);
      }
      if (destination.type === 'tableau') return this.canMoveToTableau(cards, destination.key);
      return false;
    },
    canMoveToFoundation(card, suit) {
      if (card.suit !== suit) return false;
      const pile = this.foundations[suit];
      return pile.length ? this.topCard(pile).value + 1 === card.value : card.value === 1;
    },
    canMoveToTableau(cards, pileIndex) {
      const first = cards[0];
      const pile = this.tableau[pileIndex];
      if (!pile.length) return first.value === 13;
      const target = this.topCard(pile);
      return target.faceUp && target.value === first.value + 1 && this.isOppositeColor(target, first);
    },
    applyMove(source, destination, count) {
      this.saveHistory();
      this.applyMoveWithoutHistory(source, destination, count);
    },
    applyMoveWithoutHistory(source, destination, count) {
      const cards = this.takeCards(source, count);
      if (!cards.length) {
        this.history.pop();
        return;
      }

      if (destination.type === 'foundation') {
        this.foundations[destination.key].push(...cards);
      } else {
        this.tableau[destination.key].push(...cards);
      }

      this.revealTopTableauCard(source);
      this.celebrateWinIfNeeded();
    },
    animateTapMove(source, destination, cards) {
      const flight = this.createFlight(source, destination, cards);
      if (!flight.length) {
        this.applyMove(source, destination, cards.length);
        return;
      }

      this.startFlight(cards, flight);
      this.applyMove(source, destination, cards.length);
    },
    startFlight(cards, flight, options = {}) {
      const duration = options.duration ?? FLIGHT_DURATION;
      const shouldHideCards = options.hideCards !== false;

      this.animatingCardIds = shouldHideCards ? cards.map((card) => card.id) : [];
      this.flyingCards = flight;

      requestAnimationFrame(() => {
        this.flyingCards = this.flyingCards.map((card) => ({ ...card, active: true }));
      });

      window.setTimeout(() => {
        this.animatingCardIds = [];
        requestAnimationFrame(() => {
          this.flyingCards = [];
        });
      }, duration);
    },
    createFlight(source, destination, cards) {
      const sourceElements = cards
        .map((card) => document.querySelector(`[data-card-id="${card.id}"]`))
        .filter(Boolean);
      const destinationRect = this.destinationRect(destination);

      if (!sourceElements.length || !destinationRect) return [];

      return cards.map((card, index) => {
        const sourceRect = sourceElements[index].getBoundingClientRect();
        const targetX = destinationRect.left;
        const targetY = destinationRect.top + (destination.type === 'tableau' ? this.tableau[destination.key].length * 34 + index * 34 : 0);

        return {
          flyId: `${card.id}-${Date.now()}-${index}`,
          card: { ...card },
          active: false,
          fromX: sourceRect.left,
          fromY: sourceRect.top,
          toX: targetX,
          toY: targetY,
          index,
          duration: FLIGHT_DURATION,
          className: '',
        };
      });
    },
    createStockFlight(card) {
      const stockRect = this.destinationRect({ type: 'stock' });
      const wasteRect = this.destinationRect({ type: 'waste' });

      if (!stockRect || !wasteRect) return [];

      return [
        {
          flyId: `${card.id}-${Date.now()}-stock`,
          card: { ...card },
          active: false,
          fromX: stockRect.left,
          fromY: stockRect.top,
          toX: wasteRect.left,
          toY: wasteRect.top,
          index: 0,
          duration: FLIGHT_DURATION,
          className: '',
        },
      ];
    },
    destinationRect(destination) {
      const zone = this.zoneForDestination(destination);
      return document.querySelector(`[data-zone="${zone}"]`)?.getBoundingClientRect();
    },
    zoneForDestination(destination) {
      if (destination.type === 'foundation') return `foundation-${destination.key}`;
      if (destination.type === 'tableau') return `tableau-${destination.key}`;
      return destination.type;
    },
    flyingCardStyle(card) {
      return {
        transform: `translate3d(${card.active ? card.toX : card.fromX}px, ${card.active ? card.toY : card.fromY}px, 0)`,
        zIndex: 200 + card.index,
        transitionDuration: `${card.duration ?? FLIGHT_DURATION}ms`,
      };
    },
    takeCards(source, count) {
      if (source.type === 'waste') return this.waste.splice(this.waste.length - count, count);
      if (source.type === 'foundation') return this.foundations[source.key].splice(this.foundations[source.key].length - count, count);
      return this.tableau[source.key].splice(source.index, count);
    },
    revealTopTableauCard(source) {
      if (source.type !== 'tableau') return;
      const pile = this.tableau[source.key];
      const card = this.topCard(pile);
      if (card && !card.faceUp) card.faceUp = true;
    },
    isDealSolvable(deal) {
      const initialState = this.createSolverState(deal);
      const stack = [initialState];
      const seen = new Set();
      let nodes = 0;

      while (stack.length && nodes < SOLVER_NODE_LIMIT) {
        const state = stack.pop();
        const key = this.serializeSolverState(state);
        if (seen.has(key)) continue;
        seen.add(key);
        nodes += 1;

        if (this.isSolverWon(state)) return true;

        const moves = this.solverMoves(state);
        for (let i = moves.length - 1; i >= 0; i -= 1) {
          stack.push(this.applySolverMove(state, moves[i]));
        }
      }

      return false;
    },
    createSolverState(deal) {
      return {
        stock: deal.stock.map((card) => ({ ...card, faceUp: false })),
        waste: [],
        foundations: { '♠': 0, '♥': 0, '♦': 0, '♣': 0 },
        tableau: deal.tableau.map((pile) => pile.map((card) => ({ ...card }))),
      };
    },
    serializeSolverState(state) {
      return [
        SUITS.map((suit) => state.foundations[suit]).join(''),
        state.stock.map((card) => card.id).join(','),
        state.waste.map((card) => card.id).join(','),
        state.tableau
          .map((pile) => pile.map((card) => `${card.id}${card.faceUp ? 'u' : 'd'}`).join(','))
          .join('|'),
      ].join('/');
    },
    isSolverWon(state) {
      return SUITS.every((suit) => state.foundations[suit] === 13);
    },
    solverMoves(state) {
      const moves = [];
      const wasteCard = this.topCard(state.waste);

      if (wasteCard && this.canSolverMoveToFoundation(wasteCard, state)) {
        moves.push({ type: 'waste-foundation' });
      }

      state.tableau.forEach((pile, pileIndex) => {
        const card = this.topCard(pile);
        if (card?.faceUp && this.canSolverMoveToFoundation(card, state)) {
          moves.push({ type: 'tableau-foundation', pileIndex });
        }
      });

      if (wasteCard) {
        state.tableau.forEach((pile, pileIndex) => {
          if (this.canSolverMoveToTableau(wasteCard, pile)) {
            moves.push({ type: 'waste-tableau', pileIndex });
          }
        });
      }

      state.tableau.forEach((pile, fromPile) => {
        const firstFaceUp = pile.findIndex((card) => card.faceUp);
        if (firstFaceUp === -1) return;

        for (let cardIndex = firstFaceUp; cardIndex < pile.length; cardIndex += 1) {
          const run = pile.slice(cardIndex);
          if (!this.isValidRun(run)) continue;

          state.tableau.forEach((targetPile, toPile) => {
            if (fromPile === toPile) return;
            if (this.canSolverMoveToTableau(run[0], targetPile)) {
              moves.push({ type: 'tableau-tableau', fromPile, toPile, cardIndex });
            }
          });
        }
      });

      if (state.stock.length) {
        moves.push({ type: 'draw' });
      } else if (state.waste.length) {
        moves.push({ type: 'recycle' });
      }

      return moves;
    },
    canSolverMoveToFoundation(card, state) {
      return state.foundations[card.suit] + 1 === card.value;
    },
    canSolverMoveToTableau(card, pile) {
      const target = this.topCard(pile);
      if (!target) return card.value === 13;
      return target.faceUp && target.value === card.value + 1 && this.isOppositeColor(target, card);
    },
    applySolverMove(state, move) {
      const next = {
        stock: state.stock.map((card) => ({ ...card })),
        waste: state.waste.map((card) => ({ ...card })),
        foundations: { ...state.foundations },
        tableau: state.tableau.map((pile) => pile.map((card) => ({ ...card }))),
      };

      if (move.type === 'draw') {
        const card = next.stock.pop();
        card.faceUp = true;
        next.waste.push(card);
        return next;
      }

      if (move.type === 'recycle') {
        next.stock = next.waste.reverse().map((card) => ({ ...card, faceUp: false }));
        next.waste = [];
        return next;
      }

      if (move.type === 'waste-foundation') {
        const card = next.waste.pop();
        next.foundations[card.suit] += 1;
        return next;
      }

      if (move.type === 'tableau-foundation') {
        const card = next.tableau[move.pileIndex].pop();
        next.foundations[card.suit] += 1;
        this.revealSolverTopCard(next.tableau[move.pileIndex]);
        return next;
      }

      if (move.type === 'waste-tableau') {
        next.tableau[move.pileIndex].push(next.waste.pop());
        return next;
      }

      const movedCards = next.tableau[move.fromPile].splice(move.cardIndex);
      next.tableau[move.toPile].push(...movedCards);
      this.revealSolverTopCard(next.tableau[move.fromPile]);
      return next;
    },
    revealSolverTopCard(pile) {
      const card = this.topCard(pile);
      if (card && !card.faceUp) card.faceUp = true;
    },
    findAutoCompletePlan() {
      if (this.stock.length || this.waste.length) return [];
      if (this.tableau.some((pile) => pile.some((card) => !card.faceUp))) return [];

      const foundations = JSON.parse(JSON.stringify(this.foundations));
      const tableau = JSON.parse(JSON.stringify(this.tableau));
      const plan = [];
      let moved = true;

      while (moved) {
        moved = false;

        for (let pileIndex = 0; pileIndex < tableau.length; pileIndex += 1) {
          const card = this.topCard(tableau[pileIndex]);
          if (!card || !this.canMoveCardToFoundation(card, foundations)) continue;

          tableau[pileIndex].pop();
          foundations[card.suit].push(card);
          plan.push({
            source: { type: 'tableau', key: pileIndex, index: tableau[pileIndex].length },
            destination: { type: 'foundation', key: card.suit },
            card,
          });
          moved = true;
        }
      }

      return SUITS.every((suit) => foundations[suit].length === 13) ? plan : [];
    },
    canMoveCardToFoundation(card, foundations) {
      const pile = foundations[card.suit];
      return pile.length ? this.topCard(pile).value + 1 === card.value : card.value === 1;
    },
    async autoComplete() {
      const plan = this.findAutoCompletePlan();
      if (!plan.length || this.isBusy) return;

      this.isAutoCompleting = true;
      this.saveHistory();

      while (!this.isWon) {
        const move = this.findNextFoundationMove();
        if (!move) break;

        const cards = this.cardsFromSource(move.source);
        const flight = this.createFlight(move.source, move.destination, cards);
        if (flight.length) {
          this.startFlight(cards, flight, { duration: 150 });
          this.applyMoveWithoutHistory(move.source, move.destination, 1);
          await this.sleep(160);
        } else {
          this.applyMoveWithoutHistory(move.source, move.destination, 1);
        }
      }

      this.isAutoCompleting = false;
      this.celebrateWinIfNeeded();
    },
    findNextFoundationMove() {
      for (let pileIndex = 0; pileIndex < this.tableau.length; pileIndex += 1) {
        const card = this.topCard(this.tableau[pileIndex]);
        if (card && this.canMoveToFoundation(card, card.suit)) {
          return {
            source: { type: 'tableau', key: pileIndex, index: this.tableau[pileIndex].length - 1 },
            destination: { type: 'foundation', key: card.suit },
          };
        }
      }

      return null;
    },
    prepareTestFinish() {
      if (!this.isLocalhost || this.isBusy) return;

      const deck = this.createDeck();
      this.stock = [];
      this.waste = [];
      this.foundations = { '♠': [], '♥': [], '♦': [], '♣': [] };
      this.tableau = [[], [], [], [], [], [], []];

      SUITS.forEach((suit, suitIndex) => {
        const suitCards = deck
          .filter((card) => card.suit === suit)
          .map((card) => ({ ...card, faceUp: true }));

        const cardValOnTableau = 6
        this.foundations[suit] = suitCards.filter((card) => card.value < cardValOnTableau);
        const tableauCards = [...suitCards.filter((card) => card.value >= cardValOnTableau)].reverse()
        this.tableau[suitIndex].push(...tableauCards);
      });

      this.history = [];
      this.cancelDrag();
      this.flyingCards = [];
      this.animatingCardIds = [];
      this.winBurst = false;
    },
    celebrateWinIfNeeded() {
      if (!this.isWon || this.winBurst) return;

      this.winBurst = true;
      window.setTimeout(() => {
        this.winBurst = false;
      }, 1800);
    },
    sleep(ms) {
      return new Promise((resolve) => {
        window.setTimeout(resolve, ms);
      });
    },
    cardWidth() {
      return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--card-w')) || 72;
    },
    cardHeight() {
      return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--card-h')) || this.cardWidth() * 1.42;
    },
    winSparkStyle(index) {
      const angle = (index / this.winSparks.length) * Math.PI * 2;

      return {
        '--i': index,
        '--tx': `${Math.cos(angle) * 46}vw`,
        '--ty': `${Math.sin(angle) * 46}vh`,
      };
    },
    isValidRun(cards) {
      if (!cards.length || !cards[0].faceUp) return false;
      for (let i = 1; i < cards.length; i += 1) {
        if (!cards[i].faceUp) return false;
        if (cards[i - 1].value !== cards[i].value + 1) return false;
        if (!this.isOppositeColor(cards[i - 1], cards[i])) return false;
      }
      return true;
    },
    isOppositeColor(a, b) {
      return this.cardColor(a) !== this.cardColor(b);
    },
    cardColor(card) {
      return card.suit === '♥' || card.suit === '♦' ? 'red' : 'black';
    },
    suitColor(suit) {
      return suit === '♥' || suit === '♦' ? 'red' : 'black';
    },
    topCard(pile) {
      return pile[pile.length - 1];
    },
    isSameLocation(source, destination) {
      return source.type === destination.type && source.key === destination.key;
    },
    cardStyle(index) {
      return {
        transform: `translateY(${index * 34}px)`,
        zIndex: index + 1,
      };
    },
    cardClasses(card) {
      return {
        dragging: this.dragState && this.dragState.cardIds.includes(card.id),
        'animating-hidden': this.animatingCardIds.includes(card.id),
      };
    },
  },
};
</script>
