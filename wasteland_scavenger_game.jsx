import React, { useState, useRef, useEffect } from 'react';
import { Skull, Droplet, Package, Home, Maximize, Minimize, Flame, AlertTriangle, Map, Wrench, RefreshCw, Zap, Slash, X, Binoculars, Diamond, Shield } from 'lucide-react';

// --- Helper component to render resource costs as icons ---
const RenderCost = ({ cost }) => {
  const icons = [];
  if (cost.water) {
    for (let i = 0; i < cost.water; i++) icons.push(<Droplet key={`w${i}`} className="inline h-4 w-4 text-blue-400" />);
  }
  if (cost.food) {
    for (let i = 0; i < cost.food; i++) icons.push(<Package key={`f${i}`} className="inline h-4 w-4 text-green-400" />);
  }
  if (cost.scrap) {
    for (let i = 0; i < cost.scrap; i++) icons.push(<Wrench key={`s${i}`} className="inline h-4 w-4 text-amber-400" />);
  }
  if (cost.fuel) {
    for (let i = 0; i < cost.fuel; i++) icons.push(<Flame key={`fu${i}`} className="inline h-4 w-4 text-orange-400" />);
  }
  return <div className="flex gap-1 items-center">{icons}</div>;
};

// --- Helper component for the resource checkbox track ---
const ResourceCheckbox = ({ type, state, onClick }) => {
  let content = null;
  let baseClasses = "w-6 h-6 sm:w-7 sm:h-7 rounded border-2 flex items-center justify-center transition-all";
  let colorClasses = "";

  switch (type) {
    case 'water': colorClasses = "border-blue-700"; break;
    case 'food': colorClasses = "border-green-700"; break;
    case 'scrap': colorClasses = "border-amber-700"; break;
    case 'fuel': colorClasses = "border-orange-700"; break;
    default: colorClasses = "border-stone-700";
  }

  if (state === 'acquired') {
    content = <Slash className="w-5 h-5 text-stone-300" />;
    baseClasses += " bg-stone-700 cursor-pointer hover:bg-stone-600";
  } else if (state === 'used') {
    content = <X className="w-5 h-5 text-red-500" />;
    // UPDATED: Make 'used' boxes clickable to undo
    baseClasses += " bg-stone-900 border-red-700 opacity-80 cursor-pointer hover:opacity-100";
  } else {
    // 'empty'
    baseClasses += " bg-stone-800 border-stone-700 opacity-40";
  }

  return (
    <div className={`${baseClasses} ${colorClasses}`} onClick={onClick}>
      {content}
    </div>
  );
};


export default function WastelandScavenger() {
  const [dice, setDice] = useState([0, 0, 0]);
  const [findDie, setFindDie] = useState(0); // 4th Die
  const [rolled, setRolled] = useState(false);
  const [turn, setTurn] = useState(1);
  const [gameOver, setGameOver] = useState(false);
  const [gameLost, setGameLost] = useState(false);
  const [loseReason, setLoseReason] = useState('');
  const [isFullScreen, setIsFullScreen] = useState(false);
  const containerRef = useRef(null);
  
  // --- Resource Tracks ---
  const resourceTrackSize = 15;
  
  const initialWaterTrack = Array(resourceTrackSize).fill('empty');
  initialWaterTrack[0] = 'acquired';
  const [waterTrack, setWaterTrack] = useState(initialWaterTrack);
  
  const initialFoodTrack = Array(resourceTrackSize).fill('empty');
  initialFoodTrack[0] = 'acquired';
  const [foodTrack, setFoodTrack] = useState(initialFoodTrack);

  const [scrapTrack, setScrapTrack] = useState(Array(resourceTrackSize).fill('empty'));
  const [fuelTrack, setFuelTrack] = useState(Array(resourceTrackSize).fill('empty'));
  
  // Game sheet state
  const [waterMarked, setWaterMarked] = useState(Array(6).fill(false)); 
  const [foodMarked, setFoodMarked] = useState(Array(4).fill(false)); 
  const [scrapMarked, setScrapMarked] = useState(Array(6).fill(false)); 
  const [fuelMarked, setFuelMarked] = useState(Array(6).fill(false)); 
  const [shelterMarked, setShelterMarked] = useState(Array(7).fill(false)); 
  const [explorationMarked, setExplorationMarked] = useState(Array(17).fill(false)); // 17 zones (2-18)
  const [scoutMarked, setScoutMarked] = useState(Array(11).fill(false)); 
  const [fortifyMarked, setFortifyMarked] = useState(Array(4).fill(false)); 

  // Turn tracking and radiation
  const [turnsCompleted, setTurnsCompleted] = useState([]);
  const [radiationLevel, setRadiationLevel] = useState(0);
  const [radiationZones, setRadiationZones] = useState([]);
  const [needsRadiationSetup, setNeedsRadiationSetup] = useState(true);
  
  // Engine building
  const [structures, setStructures] = useState({
    waterCollector: { name: "Water Collector", built: false, lastProduced: 0, interval: 2, cost: { scrap: 2 }, effect: "+1 💧 every 2 turns" },
    foodGarden: { name: "Food Garden", built: false, lastProduced: 0, interval: 3, cost: { fuel: 2 }, effect: "+1 📦 every 3 turns" },
    scrapRecycler: { name: "Scrap Recycler", built: false, lastProduced: 0, interval: 1, cost: { water: 3 }, effect: "+1 🔧 EVERY turn" },
    fuelRefinery: { name: "Fuel Refinery", built: false, lastProduced: 0, interval: 2, cost: { food: 2 }, effect: "+1 🔥 every 2 turns" }
  });
  
  const [showBarter, setShowBarter] = useState(false);
  
  // Tools
  const [tools, setTools] = useState({
    wrench: { uses: 0, max: 3, effect: "+/- 1 to die" },
    multitool: { uses: 0, max: 2, effect: "Reroll 1 die" },
    luckyCharm: { uses: 0, max: 1, effect: "Reroll all" }
  });
  
  const [raidersPaid, setRaidersPaid] = useState(false);
  const [raidersPaymentCount, setRaidersPaymentCount] = useState(0);

  // --- CORE LOGIC v16.2 ---
  const [diceConsumed, setDiceConsumed] = useState([false, false, false]);
  const [canEndTurn, setCanEndTurn] = useState(false);
  const [selectedDiceIndices, setSelectedDiceIndices] = useState([]);
  const [showScrapSet, setShowScrapSet] = useState(false);
  const [scoutBonusActive, setScoutBonusActive] = useState(false);
  const [barterSpendPool, setBarterSpendPool] = useState([]); 
  const [barterGainSelection, setBarterGainSelection] = useState(null); 
  const [survivalPaid, setSurvivalPaid] = useState(false); 


  const maxTurns = 12;

  const scrollbarStyles = `
    .custom-scrollbar::-webkit-scrollbar { width: 20px; height: 20px; }
    .custom-scrollbar::-webkit-scrollbar-track { background: #1c1917; border-radius: 10px; }
    .custom-scrollbar::-webkit-scrollbar-thumb { background: #d97706; border-radius: 10px; border: 3px solid #1c1917; }
    .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #f59e0b; }
    .custom-scrollbar { scrollbar-width: thick; scrollbar-color: #d97706 #1c1917; }
    
    .grid-cols-15 {
      grid-template-columns: repeat(15, minmax(0, 1fr));
    }
  `;

  // --- Resource Helper Functions ---
  const getAvailableResourceCount = (track) => track.filter(s => s === 'acquired').length;

  const gainResource = (type, amount = 1) => {
    let track, setTrack;
    if (type === 'water') { track = waterTrack; setTrack = setWaterTrack; }
    else if (type === 'food') { track = foodTrack; setTrack = setFoodTrack; }
    else if (type === 'scrap') { track = scrapTrack; setTrack = setScrapTrack; }
    else if (type === 'fuel') { track = fuelTrack; setTrack = setFuelTrack; }
    else return;

    const newTrack = [...track];
    let gained = 0;
    for (let i = 0; i < newTrack.length; i++) {
      if (gained >= amount) break;
      if (newTrack[i] === 'empty') {
        newTrack[i] = 'acquired';
        gained++;
      }
    }
    setTrack(newTrack);
  };

  const spendResourceCost = (cost) => {
    if (cost.water && getAvailableResourceCount(waterTrack) < cost.water) return false;
    if (cost.food && getAvailableResourceCount(foodTrack) < cost.food) return false;
    if (cost.scrap && getAvailableResourceCount(scrapTrack) < cost.scrap) return false;
    if (cost.fuel && getAvailableResourceCount(fuelTrack) < cost.fuel) return false;

    const spend = (track, setTrack, amount) => {
      const newTrack = [...track];
      let spent = 0;
      for (let i = newTrack.length - 1; i >= 0; i--) {
        if (spent >= amount) break;
        if (newTrack[i] === 'acquired') {
          newTrack[i] = 'used';
          spent++;
        }
      }
      setTrack(newTrack);
    };

    if (cost.water) spend(waterTrack, setWaterTrack, cost.water);
    if (cost.food) spend(foodTrack, setFoodTrack, cost.food);
    if (cost.scrap) spend(scrapTrack, setScrapTrack, cost.scrap);
    if (cost.fuel) spend(fuelTrack, setFuelTrack, cost.fuel);
    
    return true;
  };
  // --- End Resource Helpers ---
  
  useEffect(() => {
    if (rolled && diceConsumed.every(d => d === true)) {
      setCanEndTurn(true);
      setSelectedDiceIndices([]);
    }
  }, [diceConsumed, rolled]);

  useEffect(() => {
    if (radiationLevel >= 4) {
      setGameLost(true);
      setLoseReason("You succumbed to radiation poisoning!");
    }
  }, [radiationLevel]);

  const rollForRadiationZone = () => {
    const die1 = Math.floor(Math.random() * 6) + 1;
    const die2 = Math.floor(Math.random() * 6) + 1;
    const die3 = Math.floor(Math.random() * 6) + 1;
    return { dice: [die1, die2, die3], sum: die1 + die2 + die3 };
  };

  const setupRadiationZones = () => {
    const zones = [];
    while (zones.length < 3) {
      const roll = rollForRadiationZone();
      const zoneIndex = roll.sum - 2; // Min sum 3 maps to zone 3 (index 1)
      if (zoneIndex >= 1 && !zones.includes(zoneIndex)) { // Zone 2 (index 0) can't be radioactive
        zones.push(zoneIndex);
      }
    }
    setRadiationZones(zones.sort((a, b) => a - b));
    setNeedsRadiationSetup(false);
  };

  const produceFromStructures = () => {
    const newStructures = { ...structures };
    let waterAdd = 0, foodAdd = 0, scrapAdd = 0, fuelAdd = 0;

    if (newStructures.waterCollector.built && turn - newStructures.waterCollector.lastProduced >= newStructures.waterCollector.interval) {
      waterAdd++; newStructures.waterCollector.lastProduced = turn;
    }
    if (newStructures.foodGarden.built && turn - newStructures.foodGarden.lastProduced >= newStructures.foodGarden.interval) {
      foodAdd++; newStructures.foodGarden.lastProduced = turn;
    }
    if (newStructures.scrapRecycler.built && turn - newStructures.scrapRecycler.lastProduced >= newStructures.scrapRecycler.interval) {
      scrapAdd++; newStructures.scrapRecycler.lastProduced = turn;
    }
    if (newStructures.fuelRefinery.built && turn - newStructures.fuelRefinery.lastProduced >= newStructures.fuelRefinery.interval) {
      fuelAdd++; newStructures.fuelRefinery.lastProduced = turn;
    }

    if (waterAdd > 0) gainResource('water', waterAdd);
    if (foodAdd > 0) gainResource('food', foodAdd);
    if (scrapAdd > 0) gainResource('scrap', scrapAdd);
    if (fuelAdd > 0) gainResource('fuel', fuelAdd);
    
    setStructures(newStructures);
  };

  const rollDice = () => {
    const newDice = [
      Math.floor(Math.random() * 6) + 1,
      Math.floor(Math.random() * 6) + 1,
      Math.floor(Math.random() * 6) + 1
    ];
    setDice(newDice);
    setFindDie(0); // Reset find die
    setRolled(true);
    setCanEndTurn(false);
    setDiceConsumed([false, false, false]);
    setSelectedDiceIndices([]);
    setShowScrapSet(false);
    setShowBarter(false); 
    setBarterGainSelection(null);
    setBarterSpendPool([]);
    
    produceFromStructures();
  };

  const handleDieClick = (index) => {
    if (!rolled || diceConsumed[index]) return; 
    const newSelection = [...selectedDiceIndices];
    const foundIndex = newSelection.indexOf(index);

    if (foundIndex > -1) {
      newSelection.splice(foundIndex, 1);
    } else {
      newSelection.push(index);
    }
    setSelectedDiceIndices(newSelection);
    
    if (showScrapSet) {
       setShowScrapSet(false);
    }
  };

  const commitDice = (indicesToCommit) => {
    const newConsumed = [...diceConsumed];
    indicesToCommit.forEach(index => {
      newConsumed[index] = true;
    });
    setDiceConsumed(newConsumed);
    setSelectedDiceIndices([]);
  }

  // --- Marking Logic ---
  const markWater = (index) => {
    if (gameOver || waterMarked[index] || !rolled || selectedDiceIndices.length !== 2) return;
    const expectedValue = index + 1;
    const die1 = dice[selectedDiceIndices[0]];
    const die2 = dice[selectedDiceIndices[1]];
    
    if (die1 === expectedValue && die2 === expectedValue) {
      commitDice(selectedDiceIndices);
      const newMarked = [...waterMarked];
      newMarked[index] = true;
      setWaterMarked(newMarked);
      gainResource('water', 1);
    }
  };
  
  const markScrap = (index) => {
    if (gameOver || scrapMarked[index] || !rolled || selectedDiceIndices.length !== 1) return;
    const expectedValue = index + 1;
    const die1 = dice[selectedDiceIndices[0]];

    if (die1 === expectedValue) {
      commitDice(selectedDiceIndices);
      const newMarked = [...scrapMarked];
      newMarked[index] = true;
      setScrapMarked(newMarked);
      gainResource('scrap', 1);
    }
  };

  const markFood = (index) => {
    if (gameOver || foodMarked[index] || !rolled || selectedDiceIndices.length !== 3) return;
    const expectedSeq = index + 1;
    const selectedVals = selectedDiceIndices.map(i => dice[i]).sort((a,b) => a-b);
    const isSequence = selectedVals[0] === expectedSeq && selectedVals[0] + 1 === selectedVals[1] && selectedVals[1] + 1 === selectedVals[2];

    if (isSequence) {
      commitDice(selectedDiceIndices);
      const newMarked = [...foodMarked]; newMarked[index] = true; setFoodMarked(newMarked);
      gainResource('food', 1);
    }
  };

  const markFuel = (index) => {
    if (gameOver || fuelMarked[index] || !rolled || selectedDiceIndices.length !== 3) return;
    const expectedValue = index + 1;
    const die1 = dice[selectedDiceIndices[0]];
    const die2 = dice[selectedDiceIndices[1]];
    const die3 = dice[selectedDiceIndices[2]];

    if (die1 === expectedValue && die2 === expectedValue && die3 === expectedValue) {
      commitDice(selectedDiceIndices);
      const newMarked = [...fuelMarked]; newMarked[index] = true; setFuelMarked(newMarked);
      gainResource('fuel', 1);
    }
  };

  const markShelter = (index) => {
    if (gameOver || shelterMarked[index] || !rolled || selectedDiceIndices.length !== 3) return;
    const sum = dice[selectedDiceIndices[0]] + dice[selectedDiceIndices[1]] + dice[selectedDiceIndices[2]];
    const expectedSum = index + 12;

    if (sum === expectedSum) {
      commitDice(selectedDiceIndices);
      const newMarked = [...shelterMarked]; newMarked[index] = true; setShelterMarked(newMarked);
    }
  };
  
  const markFortify = () => {
    if (gameOver || !rolled || selectedDiceIndices.length !== 1) return;

    const nextBox = fortifyMarked.findIndex(x => !x);
    if (nextBox === -1) return; // Track is full

    commitDice(selectedDiceIndices);
    const newMarked = [...fortifyMarked];
    newMarked[nextBox] = true;
    setFortifyMarked(newMarked);
  };

  const markScout = (index) => {
    if (gameOver || scoutMarked[index] || !rolled || selectedDiceIndices.length !== 2) return;
    
    const sum = dice[selectedDiceIndices[0]] + dice[selectedDiceIndices[1]];
    const expectedSum = index + 2; // 0-10 -> 2-12

    if (sum === expectedSum) {
      commitDice(selectedDiceIndices);
      const newMarked = [...scoutMarked];
      newMarked[index] = true;
      setScoutMarked(newMarked);
      setScoutBonusActive(true);
    }
  };

  // UPDATED: Manual resource spend/undo from track
  const handleResourceClick = (type, index) => {
    const isSurvivalTurn = turn % 3 === 0;
    const isRaiderTurn = turn === 6 && !raidersPaid;
    
    if (!isSurvivalTurn && !isRaiderTurn) return; // Not a payment turn

    let track, setTrack;
    if (type === 'water') { track = waterTrack; setTrack = setWaterTrack; }
    else if (type === 'food') { track = foodTrack; setTrack = setFoodTrack; }
    else if (type === 'scrap') { track = scrapTrack; setTrack = setScrapTrack; }
    else if (type === 'fuel') { track = fuelTrack; setTrack = setFuelTrack; }
    else return;

    const newTrack = [...track];

    if (newTrack[index] === 'acquired') {
      // --- SPEND THE RESOURCE ---
      newTrack[index] = 'used';
      setTrack(newTrack);

      if (isRaiderTurn) {
        setRaidersPaymentCount(prev => prev + 1);
      } else if (isSurvivalTurn && (type === 'food' || type === 'water')) {
        setSurvivalPaid(true); // Mark as paid
      }
    } else if (newTrack[index] === 'used') {
      // --- UNDO THE SPEND ---
      newTrack[index] = 'acquired';
      setTrack(newTrack);

      if (isRaiderTurn) {
        setRaidersPaymentCount(prev => prev - 1);
      } else if (isSurvivalTurn && (type === 'food' || type === 'water')) {
        // Check if any other food/water is still spent for survival
        // This is tricky because we just undid one. Let's re-check all.
        const stillHasWater = waterTrack.some((s, i) => i !== index && s === 'used');
        const stillHasFood = foodTrack.some((s, i) => i !== index && s === 'used');
        
        if (!stillHasWater && !stillHasFood) {
          setSurvivalPaid(false); // No more survival resources are spent
        }
      }
    }
  };


  const markExploration = (index) => {
    if (gameOver || explorationMarked[index] || !rolled || selectedDiceIndices.length === 0) return;
    const nextZone = explorationMarked.findIndex(x => !x);
    if (nextZone !== index) return;
    const selectedSum = selectedDiceIndices.reduce((sum, i) => sum + dice[i], 0);
    const requiredSum = index + 2; // 0-16 -> 2-18
    
    if (selectedSum === requiredSum) {
      commitDice(selectedDiceIndices);
      
      const newMarked = [...explorationMarked];
      newMarked[index] = true;
      setExplorationMarked(newMarked);
      
      const hasRadiation = radiationZones.includes(index);
      
      let findTarget = 6;
      if (tools.multitool.uses > 0) findTarget--;
      if (scoutBonusActive) findTarget--;
      
      const findRoll = Math.floor(Math.random() * 6) + 1; // Roll 1d6 on the spot
      setFindDie(findRoll); // Set the 4th die to display the result

      if (findRoll >= findTarget) {
        const resourceRoll = Math.floor(Math.random() * 6) + 1;
        if (resourceRoll === 1) { /* Nothing */ }
        else if (resourceRoll <= 3) gainResource('scrap', 1); // 2-3
        else if (resourceRoll <= 4) gainResource('food', 1); // 4
        else if (resourceRoll <= 5) gainResource('water', 1); // 5
        else if (resourceRoll === 6) gainResource('fuel', 1); // 6
      }
      setScoutBonusActive(false); // Consume bonus regardless of success

      const zoneNumber = index + 2; // 0-16 -> 2-18
      const newTools = { ...tools };
      if (zoneNumber === 6 || zoneNumber === 12 || zoneNumber === 17) {
        const treasureRoll = Math.floor(Math.random() * 6) + 1;
        if (treasureRoll <= 3) { // 1-3
          gainResource('food', 2);
          gainResource('scrap', 2);
        } else if (treasureRoll === 4) {
          newTools.wrench.uses = Math.min(newTools.wrench.uses + 3, newTools.wrench.max * 3);
        } else if (treasureRoll === 5) {
          newTools.multitool.uses = Math.min(newTools.multitool.uses + 2, newTools.multitool.max * 3);
        } else if (treasureRoll === 6) {
          newTools.luckyCharm.uses = Math.min(newTools.luckyCharm.uses + 1, newTools.luckyCharm.max * 3);
        }
      }
      setTools(newTools);
      
      if (hasRadiation) setRadiationLevel(Math.min(radiationLevel + 1, 4));
    }
  };
  // --- End of Marking Logic ---


  // --- Exchange & Build ---
  const handleBarterSpendClick = (type) => {
    if (barterSpendPool.length >= 2) return;
    const currentInPool = barterSpendPool.filter(r => r === type).length;
    if (resourceCounts[type] > currentInPool) {
      setBarterSpendPool([...barterSpendPool, type]);
    }
  };

  const handleBarterGainClick = (type) => {
    setBarterGainSelection(type);
  };

  const confirmBarter = () => {
    if (barterSpendPool.length !== 2 || !barterGainSelection) return;

    const cost = {};
    barterSpendPool.forEach(r => { cost[r] = (cost[r] || 0) + 1; });

    if (spendResourceCost(cost)) {
      gainResource(barterGainSelection, 1);
      setBarterSpendPool([]);
      setBarterGainSelection(null);
    } else {
      setBarterSpendPool([]);
      setBarterGainSelection(null);
    }
  };
  
  const resetBarter = () => {
     setBarterSpendPool([]);
     setBarterGainSelection(null);
  }

  const canAffordStructure = (name) => {
    const s = structures[name];
    if (s.built) return false;
    if (s.cost.water && getAvailableResourceCount(waterTrack) < s.cost.water) return false;
    if (s.cost.food && getAvailableResourceCount(foodTrack) < s.cost.food) return false;
    if (s.cost.scrap && getAvailableResourceCount(scrapTrack) < s.cost.scrap) return false;
    if (s.cost.fuel && getAvailableResourceCount(fuelTrack) < s.cost.fuel) return false;
    return true;
  };

  const buildStructure = (name) => {
    if (!canAffordStructure(name) || rolled) return;
    const cost = structures[name].cost;
    
    if (spendResourceCost(cost)) {
      setStructures(prev => ({
        ...prev,
        [name]: { ...prev[name], built: true, lastProduced: turn }
      }));
    }
  };

  // --- Modifiers & Tools ---
  const updateDice = (newDice) => {
    setDice(newDice);
    setSelectedDiceIndices([]);
    setShowScrapSet(false);
  };

  const modifyDie = (dieIndex, change) => {
    const newDice = [...dice];
    newDice[dieIndex] = Math.max(1, Math.min(6, newDice[dieIndex] + change));
    updateDice(newDice);
  };

  const rerollOneDie = (dieIndex) => {
    const newDice = [...dice];
    newDice[dieIndex] = Math.floor(Math.random() * 6) + 1;
    updateDice(newDice);
  };

  const setDieValue = (dieIndex, value) => {
    const newDice = [...dice];
    newDice[dieIndex] = value;
    updateDice(newDice);
  };

  const useTool = (type, val = null) => {
    if (selectedDiceIndices.length !== 1) return;
    const dieIndex = selectedDiceIndices[0];
    if (diceConsumed[dieIndex]) return;

    if (type === 'wrench' && tools.wrench.uses > 0) {
      modifyDie(dieIndex, val);
      setTools(prev => ({...prev, wrench: {...prev.wrench, uses: prev.wrench.uses - 1}}));
    } else if (type === 'multitool' && tools.multitool.uses > 0) {
      rerollOneDie(dieIndex);
      setTools(prev => ({...prev, multitool: {...prev.multitool, uses: prev.multitool.uses - 1}}));
    } else if (type === 'luckyCharm' && tools.luckyCharm.uses > 0) {
        const newDice = [...dice];
        let rerolled = false;
        for (let i=0; i<3; i++) {
          if (!diceConsumed[i]) {
            newDice[i] = Math.floor(Math.random() * 6) + 1;
            rerolled = true;
          }
        }
        if (rerolled) {
          updateDice(newDice);
          setTools(prev => ({...prev, luckyCharm: {...prev.luckyCharm, uses: prev.luckyCharm.uses - 1}}));
        }
    }
  };

  const spendResourceToModify = (action, value = null) => {
    if (action === 'fuel_reroll_all') {
      if (spendResourceCost({ fuel: 1 })) {
        const newDice = [...dice];
        let rerolled = false;
        for (let i=0; i<3; i++) {
          if (!diceConsumed[i]) {
            newDice[i] = Math.floor(Math.random() * 6) + 1;
            rerolled = true;
          }
        }
        if (rerolled) {
          updateDice(newDice);
        }
      }
      return;
    }

    if (selectedDiceIndices.length !== 1 && action !== 'sacrifice') {
      if(action !== 'sacrifice') return;
    }
    
    if (action !== 'sacrifice') {
      const dieIndex = selectedDiceIndices[0];
      if (diceConsumed[dieIndex]) return;

      if (action === 'water_plus' && spendResourceCost({ water: 1 })) {
          modifyDie(dieIndex, 1);
      } else if (action === 'water_minus' && spendResourceCost({ water: 1 })) {
          modifyDie(dieIndex, -1);
      } else if (action === 'food_reroll' && spendResourceCost({ food: 1 })) {
          rerollOneDie(dieIndex);
      } else if (action === 'scrap_set' && dieIndex !== null && value !== null) {
          if(spendResourceCost({ scrap: 1 })) {
            setDieValue(dieIndex, value);
            setShowScrapSet(false);
          }
      }
    }
  };

  const sacrificeDice = (resourceType) => {
    if (selectedDiceIndices.length !== 2) return;
    const [index1, index2] = selectedDiceIndices;
    if (diceConsumed[index1] || diceConsumed[index2]) return;

    commitDice([index1, index2]);
    gainResource(resourceType, 1);
  };

  // --- Turn Management ---
  const handlePassTurn = () => {
      setRadiationLevel(Math.min(radiationLevel + 1, 4));
      setDiceConsumed([true, true, true]);
      setCanEndTurn(true);
  };
  
  const fortifyCount = fortifyMarked.filter(x => x).length;
  const shelterCount = shelterMarked.filter(x => x).length;
  const raiderCost = Math.max(0, 3 - shelterCount - fortifyCount);
  const isSurvivalTurn = turn % 3 === 0 && canEndTurn && !gameOver;
  const isRaiderTurn = turn === 6 && canEndTurn && !gameOver;

  const handleRaiderPayment = () => {
    if (raidersPaymentCount >= raiderCost) {
      setRaidersPaid(true);
    } else {
      setGameLost(true);
      setGameOver(true);
      setLoseReason(`You failed to pay the raiders! They demanded ${raiderCost} but you only paid ${raidersPaymentCount}.`);
    }
  };

  const endTurn = () => {
    if (gameOver) return;
    
    // Check Raider Payment
    if (turn === 6 && !raidersPaid) {
      if (raidersPaymentCount < raiderCost) {
         setGameLost(true); setGameOver(true); setLoseReason(`You failed to pay the raiders! They demanded ${raiderCost} but you only paid ${raidersPaymentCount}.`); return;
      }
      setRaidersPaid(true);
    }

    // Check Survival Payment
    if (turn % 3 === 0) {
      if (!survivalPaid) {
        // If survival is not paid, check if they *could* have paid
        if (resourceCounts.water > 0 || resourceCounts.food > 0) {
          setGameLost(true); setGameOver(true); setLoseReason(`You failed to spend 1 Food or Water to survive Day ${turn}!`); return;
        } else {
          setGameLost(true); setGameOver(true); setLoseReason(`You had no Food or Water to spend to survive Day ${turn}!`); return;
        }
      }
    }
    
    advanceTurn();
  };

  const advanceTurn = () => {
    if (gameOver) return;
    setTurnsCompleted([...turnsCompleted, turn]);
    if (turn >= maxTurns) {
      setGameOver(true);
    } else {
      setTurn(turn + 1);
      setRolled(false);
      setCanEndTurn(false);
      setDice([0, 0, 0]);
      setFindDie(0); // Reset find die
      setDiceConsumed([false, false, false]);
      setRaidersPaymentCount(0);
      setSurvivalPaid(false); // Reset survival tracker
    }
  };

  const calculateScore = () => {
    let score = 0;
    score += getAvailableResourceCount(waterTrack) * 3;
    score += getAvailableResourceCount(foodTrack) * 4;
    score += getAvailableResourceCount(scrapTrack) * 2;
    score += getAvailableResourceCount(fuelTrack) * 5;
    score += waterMarked.filter(x => x).length * 5;
    score += foodMarked.filter(x => x).length * 10;
    score += scrapMarked.filter(x => x).length * 3; 
    score += fuelMarked.filter(x => x).length * 8;
    score += shelterMarked.filter(x => x).length * 15;
    score += scoutMarked.filter(x => x).length * 4;
    score += fortifyMarked.filter(x => x).length === 4 ? 10 : 0;
    const exploredCount = explorationMarked.filter(x => x).length;
    score += exploredCount * 7;
    if (exploredCount >= 8) score += 30;
    if (exploredCount >= 16) score += 50;
    if (exploredCount >= 17) score += 50; 
    score -= radiationLevel * 10;
    return Math.max(0, score);
  };

  const resetGame = () => {
    setDice([0, 0, 0]); setFindDie(0); setRolled(false); setCanEndTurn(false); setTurn(1); setGameOver(false); setGameLost(false);
    setLoseReason('');
    
    const newWaterTrack = Array(resourceTrackSize).fill('empty');
    newWaterTrack[0] = 'acquired';
    setWaterTrack(newWaterTrack);
    
    const newFoodTrack = Array(resourceTrackSize).fill('empty');
    newFoodTrack[0] = 'acquired';
    setFoodTrack(newFoodTrack);

    setScrapTrack(Array(resourceTrackSize).fill('empty'));
    setFuelTrack(Array(resourceTrackSize).fill('empty'));

    setWaterMarked(Array(6).fill(false)); setFoodMarked(Array(4).fill(false));
    setScrapMarked(Array(6).fill(false)); setFuelMarked(Array(6).fill(false));
    setShelterMarked(Array(7).fill(false)); setExplorationMarked(Array(17).fill(false));
    setScoutMarked(Array(11).fill(false));
    setFortifyMarked(Array(4).fill(false));
    setRaidersPaid(false); setRaidersPaymentCount(0);
    setDiceConsumed([false, false, false]);
    setTurnsCompleted([]); setRadiationLevel(0); setRadiationZones([]); setNeedsRadiationSetup(true);
    setScoutBonusActive(false);
    setBarterGainSelection(null);
    setBarterSpendPool([]);
    setSurvivalPaid(false);
    setStructures({
      waterCollector: { name: "Water Collector", built: false, lastProduced: 0, interval: 2, cost: { scrap: 2 }, effect: "+1 💧 every 2 turns" },
      foodGarden: { name: "Food Garden", built: false, lastProduced: 0, interval: 3, cost: { fuel: 2 }, effect: "+1 📦 every 3 turns" },
      scrapRecycler: { name: "Scrap Recycler", built: false, lastProduced: 0, interval: 1, cost: { water: 3 }, effect: "+1 🔧 EVERY turn" },
      fuelRefinery: { name: "Fuel Refinery", built: false, lastProduced: 0, interval: 2, cost: { food: 2 }, effect: "+1 🔥 every 2 turns" }
    });
    setTools({
      wrench: { uses: 0, max: 3, effect: "+/- 1 to die" },
      multitool: { uses: 0, max: 2, effect: "Reroll 1 die" },
      luckyCharm: { uses: 0, max: 1, effect: "Reroll all" }
    });
  };

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) containerRef.current?.requestFullscreen().then(() => setIsFullScreen(true));
    else document.exitFullscreen().then(() => setIsFullScreen(false));
  };
  
  const resourceCounts = {
    water: getAvailableResourceCount(waterTrack),
    food: getAvailableResourceCount(foodTrack),
    scrap: getAvailableResourceCount(scrapTrack),
    fuel: getAvailableResourceCount(fuelTrack),
  };

  const canUseSingleDieModifier = selectedDiceIndices.length === 1 && !diceConsumed[selectedDiceIndices[0]];
  const canUseMultiDieModifier = !diceConsumed.every(d => d);
  const canSacrifice = selectedDiceIndices.length === 2 && !diceConsumed[selectedDiceIndices[0]] && !diceConsumed[selectedDiceIndices[1]];

  const selectedSum = selectedDiceIndices.reduce((sum, i) => sum + dice[i], 0);

  return (
    <div ref={containerRef} className="min-h-screen bg-gradient-to-b from-amber-900 via-orange-800 to-red-900 p-4 sm:p-8 overflow-auto custom-scrollbar text-stone-200">
      <style>{scrollbarStyles}</style>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-6 relative">
          <button onClick={toggleFullScreen} className="absolute right-0 top-0 p-2 bg-stone-900 border border-amber-700 rounded hover:bg-stone-800">
            {isFullScreen ? <Minimize size={20} /> : <Maximize size={20} />}
          </button>
          <h1 className="text-4xl sm:text-5xl font-bold text-amber-100 mb-2 tracking-wider drop-shadow-md">WASTELAND SCAVENGER</h1>
          <p className="text-amber-200">A Dice Allocation Game of Survival</p>
        </div>

        {/* Radiation Setup */}
        {needsRadiationSetup && (
          <div className="bg-stone-900 border-4 border-green-500 rounded-lg p-8 mb-6 text-center">
            <div className="text-3xl font-bold text-green-400 mb-4">☢️ SETUP: Determine Radiation Zones</div>
            <p className="text-lg mb-6">Roll dice 3 times to determine radioactive exploration zones.</p>
            <button onClick={setupRadiationZones} className="px-8 py-4 bg-green-700 hover:bg-green-600 text-white font-bold text-xl rounded-lg shadow-lg">
              🎲 Roll for Zones
            </button>
          </div>
        )}

        {!needsRadiationSetup && (
        <>
        {/* Top Bar: Turn, Radiation, Inventory */}
        <div className="bg-stone-900 border-2 border-amber-700 rounded-lg p-4 mb-6">
          <div className="flex flex-wrap justify-between items-center gap-4 mb-4">
            <div className="flex items-center gap-4">
                <div className="bg-stone-800 px-4 py-2 rounded border border-stone-600">
                    <span className="text-amber-100 text-sm block">Turn</span>
                    <span className="text-2xl text-amber-400 font-bold">{turn}/{maxTurns}</span>
                </div>
                <div className="bg-stone-800 px-4 py-2 rounded border border-red-900">
                    <div className="flex items-center gap-2">
                        <Skull className="text-red-500" size={16} />
                        <span className="text-amber-100 text-sm">Rad</span>
                    </div>
                    <div className="flex gap-1 mt-1">
                        {[...Array(4)].map((_, i) => (
                        <div key={i} className={`w-4 h-2 rounded-sm ${i < radiationLevel ? 'bg-red-500 shadow-[0_0_5px_rgba(239,68,68,0.8)]' : 'bg-stone-700'}`} />
                        ))}
                    </div>
                </div>
            </div>
            {gameOver && !gameLost && <div className="text-2xl font-bold text-green-400">Victory! Score: {calculateScore()}</div>}
          </div>

          <div className="grid grid-cols-12 gap-1 mb-4">
              {[...Array(12)].map((_, i) => {
                const t = i + 1;
                const isComp = turnsCompleted.includes(t);
                const isCurr = t === turn;
                const isSkull = t === 6;
                const isSurv = t % 3 === 0;
                return (
                  <div key={i} className={`h-8 rounded flex items-center justify-center text-xs font-bold relative ${
                    isComp ? 'bg-green-800 text-green-200' : isCurr ? 'bg-amber-500 text-black ring-2 ring-white' : 'bg-stone-800 text-stone-600'
                  }`}>
                    {t}
                    {isSkull && <Skull size={12} className="absolute -top-1 -right-1 text-red-500" />}
                    {isSurv && !isSkull && <Package size={10} className="absolute -top-1 -right-1 text-amber-300" />}
                  </div>
                );
              })}
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-20 flex-shrink-0 text-right">
                <div className="font-bold text-blue-400">Water</div>
                <div className="text-sm text-stone-300">({resourceCounts.water})</div>
              </div>
              <div className="grid grid-cols-15 gap-1.5 flex-grow">
                {waterTrack.map((state, i) => (
                  <ResourceCheckbox key={i} type="water" state={state} onClick={() => handleResourceClick('water', i)} />
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-20 flex-shrink-0 text-right">
                <div className="font-bold text-green-400">Food</div>
                <div className="text-sm text-stone-300">({resourceCounts.food})</div>
              </div>
              <div className="grid grid-cols-15 gap-1.5 flex-grow">
                {foodTrack.map((state, i) => (
                  <ResourceCheckbox key={i} type="food" state={state} onClick={() => handleResourceClick('food', i)} />
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-20 flex-shrink-0 text-right">
                <div className="font-bold text-amber-400">Scrap</div>
                <div className="text-sm text-stone-300">({resourceCounts.scrap})</div>
              </div>
              <div className="grid grid-cols-15 gap-1.5 flex-grow">
                {scrapTrack.map((state, i) => (
                  <ResourceCheckbox key={i} type="scrap" state={state} onClick={() => handleResourceClick('scrap', i)} />
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-20 flex-shrink-0 text-right">
                <div className="font-bold text-orange-400">Fuel</div>
                <div className="text-sm text-stone-300">({resourceCounts.fuel})</div>
              </div>
              <div className="grid grid-cols-15 gap-1.5 flex-grow">
                {fuelTrack.map((state, i) => (
                  <ResourceCheckbox key={i} type="fuel" state={state} onClick={() => handleResourceClick('fuel', i)} />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Status Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-cyan-950/50 border border-cyan-800 rounded p-3">
                <div className="text-xs text-cyan-300 font-bold mb-2 uppercase tracking-wider">Toolbelt</div>
                <div className="flex flex-col gap-1">
                    <div className={`text-xs ${tools.wrench.uses > 0 ? 'text-cyan-100' : 'text-stone-500'}`}>
                        <strong>Wrench:</strong> {tools.wrench.effect} ({tools.wrench.uses} uses)
                    </div>
                    <div className={`text-xs ${tools.multitool.uses > 0 ? 'text-cyan-100' : 'text-stone-500'}`}>
                        <strong>Multitool:</strong> {tools.multitool.effect} ({tools.multitool.uses} uses)
                    </div>
                    <div className={`text-xs ${tools.luckyCharm.uses > 0 ? 'text-cyan-100' : 'text-stone-500'}`}>
                        <strong>Lucky Charm:</strong> {tools.luckyCharm.effect} ({tools.luckyCharm.uses} uses)
                    </div>
                </div>
            </div>
            <div className="bg-stone-800 border border-stone-700 p-3 rounded">
                <div className="text-xs text-stone-400 font-bold mb-2 uppercase tracking-wider">Built Structures</div>
                <div className="flex flex-col gap-1">
                    {Object.values(structures).filter(s => s.built).map((s) => (
                        <div key={s.name} className="text-xs border bg-purple-900 border-purple-500 text-white p-1 rounded">
                            <strong>{s.name}:</strong> <span className="text-purple-200 ml-1">{s.effect}</span>
                        </div>
                    ))}
                    {Object.values(structures).every(s => !s.built) && (
                        <div className="text-xs text-stone-500 italic">None yet. Build one!</div>
                    )}
                </div>
            </div>
            <div className={`bg-stone-800 border rounded p-3 transition-all ${scoutBonusActive ? 'border-cyan-500 ring-2 ring-cyan-500' : 'border-stone-700'}`}>
                <div className="text-xs text-cyan-300 font-bold mb-2 uppercase tracking-wider">Scout Bonus</div>
                <div className="flex items-center gap-2">
                    <div className={`w-6 h-6 rounded border-2 flex items-center justify-center ${scoutBonusActive ? 'border-cyan-400 bg-cyan-700' : 'border-stone-600 bg-stone-900'}`}>
                        {scoutBonusActive && <X className="w-5 h-5 text-white" />}
                    </div>
                    <span className={`text-sm ${scoutBonusActive ? 'text-cyan-100' : 'text-stone-500'}`}>-1 To Next Find Roll</span>
                </div>
            </div>
        </div>


        {/* Dice Roller Area */}
        <div className="bg-stone-800 border-2 border-stone-600 rounded-lg p-6 mb-6 shadow-xl relative">
          <div className="flex flex-col items-center gap-6">
            
            <div className="flex flex-wrap gap-4 justify-center">
              {dice.map((die, i) => (
                <div 
                    key={i} 
                    onClick={() => handleDieClick(i)}
                    className={`w-20 h-20 rounded-xl flex items-center justify-center text-4xl font-black border-4 transition-all
                    ${diceConsumed[i] ? 'bg-stone-900 text-stone-700 border-stone-700 opacity-50' :
                      selectedDiceIndices.includes(i) ? 'ring-4 ring-white scale-110 z-10' : ''
                    }
                    ${!rolled ? 'bg-stone-700 text-stone-600 border-stone-600' : 
                      !diceConsumed[i] ? 'bg-amber-500 text-stone-900 border-amber-300 shadow-[0_4px_0_#78350f] cursor-pointer' : ''
                    }`}
                >
                  {rolled ? die : '?'}
                </div>
              ))}
              {/* --- Find Die Display --- */}
              <div className="flex flex-col items-center">
                <div className={`w-20 h-20 rounded-xl flex items-center justify-center text-4xl font-black border-4
                    ${findDie === 0 ? 'bg-stone-700 text-stone-600 border-stone-600' : 
                      'bg-cyan-700 text-white border-cyan-400'
                    }`}
                >
                  {findDie > 0 ? findDie : '?'}
                </div>
                <span className="text-xs text-cyan-300 font-bold mt-1">Find Die</span>
              </div>
            </div>

            {rolled && selectedDiceIndices.length > 0 && (
              <div className="text-lg text-white font-bold bg-stone-900/50 px-4 py-2 rounded-lg">
                Selected Sum: {selectedSum}
              </div>
            )}

            {!rolled && !canEndTurn && (
                 <div className="flex gap-2 w-full sm:w-auto flex-col sm:flex-row">
                    <button onClick={() => setShowBarter(prev => !prev)} className="px-6 py-3 bg-blue-700 hover:bg-blue-600 rounded font-bold shadow text-white">
                      {showBarter ? 'Hide Barter' : 'Show Barter'}
                    </button>
                    <button onClick={rollDice} className="px-12 py-3 bg-amber-600 hover:bg-amber-500 text-stone-900 text-xl font-black rounded shadow-lg transform hover:scale-105 transition-all flex-grow">ROLL DICE</button>
                 </div>
            )}
            
            {rolled && !canEndTurn && (
                <div className="w-full max-w-2xl bg-stone-900/50 rounded-lg p-3 border border-stone-700">
                    <div className="text-xs text-stone-500 text-center mb-2 font-mono uppercase">Dice Modifiers</div>
                    
                    {!showScrapSet ? (
                    <>
                    <div className="flex flex-wrap justify-center gap-2">
                        {/* Resource Spends */}
                        <button disabled={resourceCounts.water < 1 || !canUseSingleDieModifier} onClick={() => spendResourceToModify('water_plus')} className="flex items-center gap-1 px-2 py-1 bg-blue-900/40 border border-blue-800 hover:bg-blue-800 disabled:opacity-30 text-xs rounded text-blue-200">
                            <Droplet size={12}/> -1 Water: +1 Die
                        </button>
                        <button disabled={resourceCounts.water < 1 || !canUseSingleDieModifier} onClick={() => spendResourceToModify('water_minus')} className="flex items-center gap-1 px-2 py-1 bg-blue-900/40 border border-blue-800 hover:bg-blue-800 disabled:opacity-30 text-xs rounded text-blue-200">
                            <Droplet size={12}/> -1 Water: -1 Die
                        </button>
                        <button disabled={resourceCounts.food < 1 || !canUseSingleDieModifier} onClick={() => spendResourceToModify('food_reroll')} className="flex items-center gap-1 px-2 py-1 bg-green-900/40 border border-green-800 hover:bg-green-800 disabled:opacity-30 text-xs rounded text-green-200">
                            <Package size={12}/> -1 Food: Reroll Die
                        </button>
                        <button disabled={resourceCounts.scrap < 1 || !canUseSingleDieModifier} onClick={() => setShowScrapSet(true)} className="flex items-center gap-1 px-2 py-1 bg-amber-900/40 border border-amber-800 hover:bg-amber-800 disabled:opacity-30 text-xs rounded text-amber-200">
                            <Wrench size={12}/> -1 Scrap: Set Die
                        </button>
                        <button disabled={resourceCounts.fuel < 1 || !canUseMultiDieModifier} onClick={() => spendResourceToModify('fuel_reroll_all')} className="flex items-center gap-1 px-2 py-1 bg-orange-900/40 border border-orange-800 hover:bg-orange-800 disabled:opacity-30 text-xs rounded text-orange-200">
                            <Flame size={12}/> -1 Fuel: Reroll All
                        </button>
                    </div>

                    <div className="h-px bg-stone-700 my-2"></div>
                    
                    <div className="flex flex-wrap justify-center gap-2">
                        {/* Tools */}
                        <button disabled={tools.wrench.uses < 1 || !canUseSingleDieModifier} onClick={() => useTool('wrench', 1)} className="flex items-center gap-1 px-2 py-1 bg-cyan-900/40 border border-cyan-800 hover:bg-cyan-800 disabled:opacity-30 text-xs rounded text-cyan-200">
                            <Wrench size={12}/> Wrench (+1)
                        </button>
                        <button disabled={tools.wrench.uses < 1 || !canUseSingleDieModifier} onClick={() => useTool('wrench', -1)} className="flex items-center gap-1 px-2 py-1 bg-cyan-900/40 border border-cyan-800 hover:bg-cyan-800 disabled:opacity-30 text-xs rounded text-cyan-200">
                            <Wrench size={12}/> Wrench (-1)
                        </button>
                        <button disabled={tools.multitool.uses < 1 || !canUseSingleDieModifier} onClick={() => useTool('multitool')} className="flex items-center gap-1 px-2 py-1 bg-cyan-900/40 border border-cyan-800 hover:bg-cyan-800 disabled:opacity-30 text-xs rounded text-cyan-200">
                            <Wrench size={12}/> Multi (Reroll)
                        </button>
                        <button disabled={tools.luckyCharm.uses < 1 || !canUseMultiDieModifier} onClick={() => useTool('luckyCharm')} className="flex items-center gap-1 px-2 py-1 bg-cyan-900/40 border border-cyan-800 hover:bg-cyan-800 disabled:opacity-30 text-xs rounded text-cyan-200">
                            <Zap size={12}/> Charm (Reroll All)
                        </button>
                    </div>
                    {/* --- Sacrifice Section --- */}
                    <div className="h-px bg-stone-700 my-2"></div>
                    <div className="text-xs text-stone-500 text-center mb-2 font-mono uppercase">Sacrifice 2 Dice</div>
                    <div className="flex flex-wrap justify-center gap-2">
                       <button disabled={!canSacrifice} onClick={() => sacrificeDice('water')} className="flex items-center gap-1 px-2 py-1 bg-blue-900/40 border border-blue-800 hover:bg-blue-800 disabled:opacity-30 text-xs rounded text-blue-200">
                            For +1 <Droplet size={12}/>
                       </button>
                       <button disabled={!canSacrifice} onClick={() => sacrificeDice('food')} className="flex items-center gap-1 px-2 py-1 bg-green-900/40 border border-green-800 hover:bg-green-800 disabled:opacity-30 text-xs rounded text-green-200">
                            For +1 <Package size={12}/>
                       </button>
                       <button disabled={!canSacrifice} onClick={() => sacrificeDice('scrap')} className="flex items-center gap-1 px-2 py-1 bg-amber-900/40 border border-amber-800 hover:bg-amber-800 disabled:opacity-30 text-xs rounded text-amber-200">
                            For +1 <Wrench size={12}/>
                       </button>
                       <button disabled={!canSacrifice} onClick={() => sacrificeDice('fuel')} className="flex items-center gap-1 px-2 py-1 bg-orange-900/40 border border-orange-800 hover:bg-orange-800 disabled:opacity-30 text-xs rounded text-orange-200">
                            For +1 <Flame size={12}/>
                       </button>
                    </div>
                    {/* --- End Sacrifice --- */}

                    </>
                    ) : ( // Show "Set Die" panel
                    <div className="text-center">
                        <div className="text-sm text-amber-200 mb-2">Set selected die to:</div>
                        <div className="flex flex-wrap justify-center gap-2">
                            {[1,2,3,4,5,6].map(val => (
                                <button key={val} onClick={() => spendResourceToModify('scrap_set', val)} className="w-10 h-10 rounded bg-stone-700 hover:bg-amber-600 hover:text-black font-bold text-white">
                                    {val}
                                </button>
                            ))}
                        </div>
                        <button onClick={() => setShowScrapSet(false)} className="text-xs text-stone-400 hover:text-white mt-3">
                            Cancel
                        </button>
                    </div>
                    )}
                </div>
            )}
            
            {rolled && !canEndTurn && !gameOver && (
                <div className="flex gap-4 w-full justify-between items-center border-t border-stone-700 pt-4">
                    <button onClick={handlePassTurn} className="text-red-400 hover:text-red-300 text-sm flex items-center gap-1 px-3 py-2 hover:bg-stone-700 rounded transition-colors">
                        <Skull size={16}/> Scavenge Failed (Spend remaining dice, +1 Rad)
                    </button>
                    <div className="text-stone-500 text-sm italic">Allocate all dice...</div>
                </div>
            )}

            {/* Raider Warning & Payment Button */}
            {turn === 6 && !raidersPaid && canEndTurn && (
                <div className="text-center p-4 bg-red-900 border-2 border-red-500 rounded-lg">
                    <h3 className="text-xl font-bold text-red-100 mb-2">RAIDERS DEMAND PAYMENT!</h3>
                    <p className="text-red-200">You must pay {raiderCost} resources. Click your resource boxes (`/`) to pay.</p>
                    <p className="text-red-200 mb-3">You have paid {raidersPaymentCount} / {raiderCost}.</p>
                    <button 
                      onClick={handleRaiderPayment}
                      className="px-6 py-2 bg-red-600 hover:bg-red-500 text-white font-bold rounded"
                    >
                      Confirm Payment
                    </button>
                </div>
            )}
            
            {/* Survival Warning (No Modal) */}
            {isSurvivalTurn && !isRaiderTurn && ( // Standard survival day
              <div className="text-center p-4 bg-green-900 border-2 border-green-500 rounded-lg">
                  <h3 className="text-xl font-bold text-green-100 mb-2">SURVIVAL CHECK</h3>
                  <p className="text-green-200">You must spend 1 **Food or Water** to survive. Click a resource box (`/`) above *before* ending your turn.</p>
              </div>
            )}
            
            {isRaiderTurn && raidersPaid && ( // Turn 6 *after* raiders are paid
               <div className="text-center p-4 bg-green-900 border-2 border-green-500 rounded-lg">
                  <h3 className="text-xl font-bold text-green-100 mb-2">SURVIVAL CHECK</h3>
                  <p className="text-green-200">Raiders are paid. You must still spend 1 **Food or Water** for survival. Click a resource box (`/`) above *before* ending your turn.</p>
              </div>
            )}


            {canEndTurn && !gameOver && (
              <button 
                onClick={endTurn} 
                disabled={ (isSurvivalTurn && !survivalPaid) && (resourceCounts.water + resourceCounts.food === 0) }
                className="px-12 py-4 bg-red-700 hover:bg-red-600 text-white text-xl font-black rounded shadow-lg transform hover:scale-105 transition-all disabled:bg-stone-700 disabled:cursor-not-allowed"
              >
                END TURN
              </button>
            )}

          </div>
        </div>

        {/* Barter Panel (No longer a modal) */}
        {showBarter && !rolled && (
            <div className="bg-blue-950/50 border-2 border-blue-800 rounded-lg p-4 mb-6">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold text-blue-200">Barter Resources (Pre-Roll Action)</h2>
                    <button onClick={() => { setShowBarter(false); resetBarter(); }} className="text-blue-200 font-bold text-2xl">✕</button>
                </div>
                <p className="text-sm text-blue-200 mb-3">Trade **ANY 2** resources for **1** of your choice. (e.g., 1 Water + 1 Scrap for 1 Fuel)</p>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* SPEND COLUMN */}
                    <div className="bg-stone-900/50 p-3 rounded">
                        <h3 className="font-bold text-white mb-2">1. Spend 2 Resources:</h3>
                        <div className="flex flex-wrap gap-2">
                            <button 
                                disabled={barterSpendPool.length >= 2 || resourceCounts.water <= barterSpendPool.filter(r=>r==='water').length}
                                onClick={() => handleBarterSpendClick('water')}
                                className="flex items-center gap-1 px-3 py-2 bg-blue-900/40 border border-blue-800 hover:bg-blue-800 disabled:opacity-30 text-xs rounded text-blue-200"
                            >
                                <Droplet size={12}/> Spend Water
                            </button>
                            <button 
                                disabled={barterSpendPool.length >= 2 || resourceCounts.food <= barterSpendPool.filter(r=>r==='food').length}
                                onClick={() => handleBarterSpendClick('food')}
                                className="flex items-center gap-1 px-3 py-2 bg-green-900/40 border border-green-800 hover:bg-green-800 disabled:opacity-30 text-xs rounded text-green-200"
                            >
                                <Package size={12}/> Spend Food
                            </button>
                            <button 
                                disabled={barterSpendPool.length >= 2 || resourceCounts.scrap <= barterSpendPool.filter(r=>r==='scrap').length}
                                onClick={() => handleBarterSpendClick('scrap')}
                                className="flex items-center gap-1 px-3 py-2 bg-amber-900/40 border border-amber-800 hover:bg-amber-800 disabled:opacity-30 text-xs rounded text-amber-200"
                            >
                                <Wrench size={12}/> Spend Scrap
                            </button>
                            <button 
                                disabled={barterSpendPool.length >= 2 || resourceCounts.fuel <= barterSpendPool.filter(r=>r==='fuel').length}
                                onClick={() => handleBarterSpendClick('fuel')}
                                className="flex items-center gap-1 px-3 py-2 bg-orange-900/40 border border-orange-800 hover:bg-orange-800 disabled:opacity-30 text-xs rounded text-orange-200"
                            >
                                <Flame size={12}/> Spend Fuel
                            </button>
                        </div>
                    </div>
                    
                    {/* GAIN COLUMN */}
                    <div className="bg-stone-900/50 p-3 rounded">
                        <h3 className="font-bold text-white mb-2">2. Gain 1 Resource:</h3>
                        <div className="flex flex-wrap gap-2">
                             <button 
                                onClick={() => handleBarterGainClick('water')}
                                className={`flex items-center gap-1 px-3 py-2 border hover:bg-blue-800 text-xs rounded ${barterGainSelection === 'water' ? 'bg-blue-800 border-blue-500 text-white' : 'bg-blue-900/40 border-blue-800 text-blue-200'}`}
                            >
                                <Droplet size={12}/> Gain Water
                            </button>
                            <button 
                                onClick={() => handleBarterGainClick('food')}
                                className={`flex items-center gap-1 px-3 py-2 border hover:bg-green-800 text-xs rounded ${barterGainSelection === 'food' ? 'bg-green-800 border-green-500 text-white' : 'bg-green-900/40 border-green-800 text-green-200'}`}
                            >
                                <Package size={12}/> Gain Food
                            </button>
                            <button 
                                onClick={() => handleBarterGainClick('scrap')}
                                className={`flex items-center gap-1 px-3 py-2 border hover:bg-amber-800 text-xs rounded ${barterGainSelection === 'scrap' ? 'bg-amber-800 border-amber-500 text-white' : 'bg-amber-900/40 border-amber-800 text-amber-200'}`}
                            >
                                <Wrench size={12}/> Gain Scrap
                            </button>
                            <button 
                                onClick={() => handleBarterGainClick('fuel')}
                                className={`flex items-center gap-1 px-3 py-2 border hover:bg-orange-800 text-xs rounded ${barterGainSelection === 'fuel' ? 'bg-orange-800 border-orange-500 text-white' : 'bg-orange-900/40 border-orange-800 text-orange-200'}`}
                            >
                                <Flame size={12}/> Gain Fuel
                            </button>
                        </div>
                    </div>

                    {/* CONFIRM COLUMN */}
                    <div className="bg-stone-900/50 p-3 rounded">
                        <h3 className="font-bold text-white mb-2">3. Confirm Trade:</h3>
                        <div className="text-sm text-stone-400 mb-2 capitalize">
                            Pool: {barterSpendPool.length > 0 ? barterSpendPool.join(', ') : 'Empty'}
                        </div>
                        <div className="text-sm text-stone-400 mb-2 capitalize">
                            Gain: {barterGainSelection || 'None'}
                        </div>
                        <button 
                            disabled={barterSpendPool.length !== 2 || !barterGainSelection}
                            onClick={confirmBarter}
                            className="w-full px-3 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-30 text-sm rounded text-white font-bold"
                        >
                            Confirm Trade
                        </button>
                        <button 
                            onClick={resetBarter}
                            className="w-full text-xs text-stone-400 hover:text-white mt-2"
                        >
                            Reset
                        </button>
                    </div>
                </div>
            </div>
        )}
        
        {/* --- CRAFTING SECTION --- */}
        <div className="bg-purple-950/50 border-2 border-purple-800 rounded-lg p-4 mb-6">
            <h2 className="text-2xl font-bold text-purple-200 mb-4">Craft Structures (Pre-Roll Action)</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {Object.entries(structures).map(([key, s]) => (
                    <div 
                        key={key}
                        className={`p-4 rounded-lg border-2 flex flex-col justify-between
                        ${s.built ? 'bg-purple-900 border-purple-600' : 'bg-stone-900 border-purple-800'}
                        ${rolled ? 'opacity-50' : ''}`}
                    >
                        <div>
                            <h3 className="font-bold text-lg text-white mb-1">{s.name}</h3>
                            <p className="text-sm text-purple-200 mb-2">{s.effect}</p>
                        </div>
                        <div>
                            <div className="flex items-center gap-2 mb-3">
                                <span className="text-xs text-stone-400">COST:</span>
                                <RenderCost cost={s.cost} />
                            </div>
                            {s.built ? (
                                <button disabled className="w-full py-2 rounded font-bold bg-green-800 text-green-300 border border-green-700">✓ BUILT</button>
                            ) : (
                                <button
                                    disabled={!canAffordStructure(key) || rolled}
                                    onClick={() => buildStructure(key)}
                                    className="w-full py-2 rounded font-bold transition-all
                                    bg-purple-700 text-white
                                    hover:bg-purple-600
                                    disabled:bg-stone-700 disabled:text-stone-500 disabled:cursor-not-allowed"
                                >
                                    Build
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>


        {/* Game Sheet Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 opacity-90">
            
            <div className="bg-stone-900/80 border border-amber-900 p-4 rounded">
                <h3 className="text-amber-400 font-bold mb-2 flex items-center gap-2"><Wrench size={18}/> Scrap (Single Die) - Uses 1 Die</h3>
                <div className="grid grid-cols-6 gap-2">
                    {[1,2,3,4,5,6].map((n, i) => (
                        <button key={i} disabled={scrapMarked[i] || !rolled} onClick={() => markScrap(i)} 
                            className={`aspect-square rounded flex items-center justify-center font-bold border-2 transition-all text-lg
                            ${scrapMarked[i] ? 'bg-amber-600 border-amber-400 text-white' : 'bg-stone-800 border-stone-700 hover:border-amber-500 text-stone-500'}`}>
                            {n}
                        </button>
                    ))}
                </div>
            </div>

            <div className="bg-stone-900/80 border border-gray-700 p-4 rounded">
                <h3 className="text-gray-400 font-bold mb-2 flex items-center gap-2"><Shield size={18}/> Fortify (Any Die) - Uses 1 Die</h3>
                <p className="text-sm text-gray-300 mb-3">🎁 Each box marked reduces Raider cost by 1. 4th box = +10 VP!</p>
                <div className="grid grid-cols-4 gap-2">
                    {fortifyMarked.map((isMarked, i) => (
                        <button key={i} disabled={isMarked || !rolled || selectedDiceIndices.length !== 1} onClick={() => markFortify()} 
                            className={`h-12 rounded flex items-center justify-center font-bold border-2 transition-all text-sm
                            ${isMarked ? 'bg-gray-600 border-gray-400 text-white' : 'bg-stone-800 border-stone-700 hover:border-gray-500 text-stone-500'}`}>
                            {i < 3 ? `-${i+1} Cost` : "+10 VP"}
                        </button>
                    ))}
                </div>
            </div>

            <div className="bg-stone-900/80 border border-cyan-900 p-4 rounded">
                <h3 className="text-cyan-400 font-bold mb-2 flex items-center gap-2"><Binoculars size={18}/> Scout (2-Die Sum) - Uses 2 Dice</h3>
                <p className="text-sm text-cyan-200 mb-3">🎁 Gain a -1 bonus to your next Exploration find roll. (4 pts each)</p>
                <div className="grid grid-cols-6 gap-2">
                    {[2,3,4,5,6,7,8,9,10,11,12].map((n, i) => (
                        <button key={i} disabled={scoutMarked[i] || !rolled} onClick={() => markScout(i)} 
                            className={`aspect-square rounded flex items-center justify-center font-bold border-2 transition-all text-lg
                            ${scoutMarked[i] ? 'bg-cyan-600 border-cyan-400 text-white' : 'bg-stone-800 border-stone-700 hover:border-cyan-500 text-stone-500'}`}>
                            {n}
                        </button>
                    ))}
                </div>
            </div>

            <div className="bg-stone-900/80 border border-blue-900 p-4 rounded">
                <h3 className="text-blue-400 font-bold mb-2 flex items-center gap-2"><Droplet size={18}/> Water (Pairs) - Uses 2 Dice</h3>
                <div className="grid grid-cols-6 gap-2">
                    {[1,2,3,4,5,6].map(i => (
                        <button key={i} disabled={waterMarked[i-1] || !rolled} onClick={() => markWater(i-1)} 
                            className={`aspect-square rounded flex items-center justify-center font-bold border-2 transition-all text-lg
                            ${waterMarked[i-1] ? 'bg-blue-600 border-blue-400 text-white' : 'bg-stone-800 border-stone-700 hover:border-blue-500 text-stone-500'}`}>
                            {i}{i}
                        </button>
                    ))}
                </div>
            </div>

            <div className="bg-stone-900/80 border border-green-900 p-4 rounded">
                <h3 className="text-green-400 font-bold mb-2 flex items-center gap-2"><Package size={18}/> Food (Run of 3) - Uses 3 Dice</h3>
                <div className="grid grid-cols-4 gap-2">
                    {['1-2-3','2-3-4','3-4-5','4-5-6'].map((l, i) => (
                        <button key={i} disabled={foodMarked[i] || !rolled} onClick={() => markFood(i)} 
                            className={`h-12 rounded flex items-center justify-center font-bold border-2 transition-all text-sm
                            ${foodMarked[i] ? 'bg-green-600 border-green-400 text-white' : 'bg-stone-800 border-stone-700 hover:border-green-500 text-stone-500'}`}>
                            {l}
                        </button>
                    ))}
                </div>
            </div>

            <div className="bg-stone-900/80 border border-orange-900 p-4 rounded">
                <h3 className="text-orange-400 font-bold mb-2 flex items-center gap-2"><Flame size={18}/> Fuel (Triples) - Uses 3 Dice</h3>
                <div className="grid grid-cols-6 gap-2">
                    {[1,2,3,4,5,6].map(i => (
                        <button key={i} disabled={fuelMarked[i-1] || !rolled} onClick={() => markFuel(i-1)} 
                            className={`aspect-square rounded flex items-center justify-center font-bold border-2 transition-all text-lg
                            ${fuelMarked[i-1] ? 'bg-orange-600 border-orange-400 text-white' : 'bg-stone-800 border-stone-700 hover:border-orange-500 text-stone-500'}`}>
                            {i}{i}{i}
                        </button>
                    ))}
                </div>
            </div>
            
            <div className="bg-stone-900/80 border border-purple-900 p-4 rounded lg:col-span-2">
                <h3 className="text-purple-400 font-bold mb-2 flex items-center gap-2"><Home size={18}/> Shelter (High Sums) - Uses 3 Dice</h3>
                <p className="text-sm text-purple-200 mb-3">🏠 Each shelter reduces Raider payment by 1. (15 pts each)</p>
                <div className="grid grid-cols-7 gap-2">
                    {[12,13,14,15,16,17,18].map((n, i) => (
                        <button key={i} disabled={shelterMarked[i] || !rolled} onClick={() => markShelter(i)} 
                            className={`aspect-square rounded flex items-center justify-center font-bold border-2 transition-all
                            ${shelterMarked[i] ? 'bg-purple-600 border-purple-400 text-white' : 'bg-stone-800 border-stone-700 hover:border-purple-500 text-stone-500'}`}>
                            {n}
                        </button>
                    ))}
                </div>
            </div>
            
            {/* REMOVED Barter Section */}

            <div className="bg-stone-900/80 border border-cyan-900 p-4 rounded lg:col-span-2">
                <div className="flex flex-col sm:flex-row justify-between gap-4">
                  <div>
                    <h3 className="text-cyan-400 font-bold mb-2 flex items-center gap-2"><Map size={18}/> Exploration (Sequential 2-18) - Uses 1-3 Dice</h3>
                    <p className="text-sm text-cyan-200 mb-3">🎁 Roll "Find Die" on mark. Base target 6. (Multitool/Scout lowers target). 💎 = Treasure Roll!</p>
                  </div>
                  <div className="flex gap-4 flex-shrink-0">
                    <div className="text-xs bg-stone-800 p-2 rounded border border-stone-600">
                      <h4 className="font-bold text-white mb-1 text-center">Find Roll (1d6)</h4>
                      <p>1: Nothing</p>
                      <p>2-3: +1 Scrap</p>
                      <p>4: +1 Food</p>
                      <p>5: +1 Water</p>
                      <p>6: +1 Fuel</p>
                    </div>
                    <div className="text-xs bg-stone-800 p-2 rounded border border-stone-600">
                      <h4 className="font-bold text-white mb-1 text-center">Treasure Roll (1d6)</h4>
                      <p>1: Nothing</p>
                      <p>2-3: +2 Food, +2 Scrap</p>
                      <p>4: +1 Wrench (3 uses)</p>
                      <p>5: +1 Multitool (2 uses)</p>
                      <p>6: +1 Lucky Charm (1 use)</p>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-9 gap-2 mt-3">
                    {[...Array(17)].map((_, i) => { // 17 zones
                        const zone = i + 2; // Start from 2
                        const isRad = radiationZones.includes(i);
                        const isMarked = explorationMarked[i];
                        const nextZoneIndex = explorationMarked.findIndex(x => !x);
                        const isNext = nextZoneIndex === i;
                        const isTreasure = zone === 6 || zone === 12 || zone === 17;

                        return (
                            <button key={i} disabled={!isNext || !rolled || selectedDiceIndices.length === 0} onClick={() => markExploration(i)} 
                                className={`h-12 rounded flex items-center justify-center font-bold border-2 transition-all relative
                                ${isMarked ? 
                                    (isRad ? 'bg-red-700 border-red-500 text-white' : 'bg-cyan-700 border-cyan-500 text-white') : 
                                    (isNext ? 'bg-stone-700 border-white animate-pulse text-white' : 'bg-stone-800 border-stone-700 text-stone-600')
                                }`}>
                                {zone}
                                {isRad && <Skull size={12} className={`absolute top-0.5 right-0.5 ${isMarked ? 'text-black' : 'text-red-500'}`}/>}
                                {isTreasure && <Diamond size={12} className={`absolute bottom-0.5 right-0.5 ${isMarked ? 'text-black' : 'text-yellow-400'}`}/>}
                            </button>
                        )
                    })}
                </div>
            </div>
        </div>
        
        {/* --- RULES SECTION (Updated for v16.1) --- */}
        <div className="mt-8 bg-stone-900/80 border-2 border-amber-900 rounded-lg p-6">
          <h3 className="text-2xl font-bold text-amber-100 mb-4">How to Play (v16.1 - Dynamic Find Die)</h3>
          <div className="text-amber-200 text-sm space-y-4 max-w-none">
            
            <p className="font-bold text-base"><strong>GOAL:</strong> Survive 12 turns and get the highest score. You start with 1 Food and 1 Water.</p>

            <div>
                <strong className="text-amber-100">RESOURCE TRACKING:</strong>
                <ul className="list-disc list-inside ml-4 mt-1 space-y-1">
                    <li>Gaining a resource fills the first empty box with a slash (`/`).</li>
                    <li>Spending a resource crosses out the last slashed box with an (`X`).</li>
                    <li>**You must manually spend resources by clicking the slashed (`/`) boxes in your inventory.**</li>
                </ul>
            </div>

            <div>
                <strong className="text-amber-100">TURN FLOW:</strong>
                <ul className="list-disc list-inside ml-4 mt-1 space-y-1">
                    <li><strong>1. (Optional) Pre-Roll Actions:</strong> Before rolling, you may <strong>Barter</strong> resources (toggles a panel) or <strong>Build</strong> structures.</li>
                    <li><strong>2. Roll Dice:</strong> Click "ROLL DICE". You get 3 normal dice. Structures produce. Crafting & Barter are now disabled. The "Find Die" is reset to `?`.</li>
                    <li><strong>3. (Optional) Modify Dice:</strong> Click ONE die to select it, then click a modifier button (e.g., "-1 Water" or "Wrench").</li>
                    <li><strong>4. Allocate Dice:</strong> Click dice to select them. Then, click a matching box on the board to spend them.
                        <ul className="list-['--'] list-inside ml-5 mt-1">
                            <li>A "Selected Sum" will appear to help you.</li>
                            <li>Select 2 *unused* dice and click a "Sacrifice 2 Dice" button to gain 1 resource of your choice.</li>
                        </ul>
                    </li>
                    <li><strong>5. End Turn:</strong> Once all 3 dice are allocated (dimmed), the "END TURN" button will appear.</li>
                    <li><strong>6. (Alternative) Scavenge Failed:</strong> If stuck, click "Scavenge Failed". This spends all *remaining* dice, gives +1 Radiation, and lets you end the turn.</li>
                    <li><strong>7. Survival:</strong> On Survival Days (3, 6, 9, 12), you must **manually click 1 Food or Water box (`/`)** to spend it *before* clicking End Turn.</li>
                </ul>
            </div>
            
            <div>
                <strong className="text-red-400">RADIATION:</strong>
                <ul className="list-disc list-inside ml-4 mt-1 space-y-1">
                    <li>The Radiation Track has 4 boxes.</li>
                    <li>If you ever gain a 4th Radiation point, **YOU DIE** and the game is over.</li>
                </ul>
            </div>
            
            <div>
                <strong className="text-amber-100">SURVIVAL & RAIDERS:</strong>
                <ul className="list-disc list-inside ml-4 mt-1 space-y-1">
                    <li><strong>Survival Days (🍖):</strong> On turns 3, 9, and 12, you must spend 1 **Food or Water**. The game will remind you.</li>
                    <li><strong>Raiders (💀):</strong> On turn 6, you must pay <strong>3 Resources</strong> (minus 1 per Shelter *and* 1 per Fortify box). Click your resource boxes to pay.
                    </li>
                    <li>Click **"Confirm Raider Payment"** when you are done. Then, you must *also* pay the 1 **Food or Water** survival cost for turn 6.</li>
                </ul>
            </div>

            <div>
                <strong className="text-amber-100">GAME SHEET SECTIONS (Dice Used):</strong>
                <ul className="list-disc list-inside ml-4 mt-1 space-y-1">
                    <li><strong>Scrap (🔧) (Uses 1 Die):</strong> Select 1 die. Click the matching box (e.g., `6`). Gain 1 Scrap.</li>
                    <li><strong>Fortify (🛡️) (Uses 1 Die):</strong> Select 1 die (any value). Mark the next available box. Each of the first 3 boxes reduces Raider cost by 1. The 4th box is +10 VP.</li>
                    <li><strong>Scout (🔭) (Uses 2 Dice):</strong> Select 2 dice. Click the box matching their sum (2-12). Check the "Scout Bonus" box.</li>
                    <li><strong>Water (💧) (Uses 2 Dice):</strong> Select 2 dice that form a pair. Click the matching box (e.g., `44`). Gain 1 Water.</li>
                    <li><strong>Food (📦) (Uses 3 Dice):</strong> Select 3 dice that form a sequence (e.g., `1-2-3`). Gain 1 Food.</li>
                    <li><strong>Fuel (🔥) (Uses 3 Dice):</strong> Select 3 dice that form a triple (e.g., `555`). Gain 1 Fuel.</li>
                    <li><strong>Shelter (🏠) (Uses 3 Dice):</strong> Select 3 dice. Click the box matching their sum (12-18). Reduces Raider cost by 1.</li>
                    <li><strong>Exploration (🗺️) (Uses 1-3 Dice):</strong> Select dice. Click the *next available* zone (2-18) if their sum *exactly* matches the zone number.
                        <ul className="list-['--'] list-inside ml-5 mt-1">
                            <li>**Find Roll:** When you mark the zone, the game *rolls the 4th "Find Die"* for a chance to find a bonus resource. Base target is 6.</li>
                            <li>Having a **Multitool** or an active **Scout Bonus** (which is then consumed) lowers the target.</li>
                            <li>**Treasure (💎):** On zones 6, 12, & 17, you *also* roll a *new 1d6* on the Treasure Table.</li>
                        </ul>
                    </li>
                </ul>
            </div>
          </div>
        </div>

        {/* Loss Screen */}
        {gameLost && (
            <div className="fixed inset-0 bg-red-950/90 z-50 flex items-center justify-center p-4">
                <div className="text-center max-w-xl">
                    <Skull className="w-24 h-24 mx-auto text-red-500 mb-4"/>
                    <h2 className="text-4xl font-black text-red-100 mb-4">WASTED</h2>
                    <p className="text-xl text-red-200 mb-8">{loseReason}</p>
                    <div className="text-2xl text-amber-400 font-bold mb-8">Final Score: {calculateScore()}</div>
                    <button onClick={resetGame} className="px-8 py-3 bg-white text-red-900 font-bold rounded hover:bg-stone-200">Try Again</button>
                </div>
            </div>
        )}
        
        {/* REMOVED: All Modals */}

        </>
        )}
      </div>
    </div>
  );
}
