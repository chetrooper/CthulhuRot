// Create our Mixins namespace
Game.EntityMixins = {};

// Main player's actor mixin
Game.EntityMixins.PlayerActor = {
    name: 'PlayerActor',
    groupName: 'Actor',
    conditions: {},
    act: function() {        
        if (this._acting) {
            return;
        }
        
        this._acting = true;
        this.addTurnHunger();
        this.actPoisonTurn();
        
        // process story actions by turn
        Game.Narrator.processNarrationTurn(this);
        
        // Detect if the game is over
        if (!this.isAlive()) {
            Game.Screen.playScreen.setGameEnded(true);
            // Send a last message to the player
            Game.sendMessage(this, 'Press [Enter] to continue!');
        }
        // Re-render the screen
        Game.refresh();
        // Lock the engine and wait asynchronously
        // for the player to press a key.
        this.getMap().getEngine().lock();
        
        // Clear the message queue
        this.clearMessages();
        this._acting = false;
    }
};

Game.EntityMixins.FungusActor = {
    name: 'FungusActor',
    groupName: 'Actor',
    init: function() {
        this._growthsRemaining = 3;
    },
    act: function() {
        // Check if we are going to try growing this turn
        if (this._growthsRemaining > 0) {
            if (ROT.RNG.getUniform() <= 0.01) {
                // Generate the coordinates of a random adjacent square by
                // generating an offset between [-1, 0, 1] for both the x and
                // y directions. To do this, we generate a number from 0-2 and then
                // subtract 1.
                var xOffset = Math.floor(ROT.RNG.getUniform() * 3) - 1;
                var yOffset = Math.floor(ROT.RNG.getUniform() * 3) - 1;
                // Make sure we aren't trying to spawn on the same tile as us
                if (xOffset != 0 || yOffset != 0) {
                    // Check if we can actually spawn at that location, and if so
                    // then we grow!
                    if (this.getMap().isEmptyFloor(this.getX() + xOffset,
                                                   this.getY() + yOffset,
                                                   this.getZ())) {
                        var entity = Game.EntityRepository.create('fungus');
                        entity.setPosition(this.getX() + xOffset, this.getY() + yOffset,
                            this.getZ());
                        this.getMap().addEntity(entity);
                        this._growthsRemaining--;
                        // Send a message nearby!
                        Game.sendMessageNearby(this.getMap(),
                            entity.getX(), entity.getY(), entity.getZ(),
                            'The fungus is spreading!');
                    }
                }
            }
        }
    }
};

Game.EntityMixins.TaskActor = {
    name: 'TaskActor',
    groupName: 'Actor',
    init: function(template) {
        // Load tasks
        this._tasks = template['tasks'] || ['wander']; 
    },
    act: function() {
        // Iterate through all our tasks
        for (var i = 0; i < this._tasks.length; i++) {
            if (this.canDoTask(this._tasks[i])) {
                // If we can perform the task, execute the function for it.
                this[this._tasks[i]]();
                return;
            }
        }
    },
    canDoTask: function(task) {
        if (task === 'hunt') {
            return this.hasMixin('Sight') && this.canSee(this.getMap().getPlayer());
        } else if (task === 'wander') {
            return true;
        } else {
            throw new Error('Tried to perform undefined task ' + task);
        }
    },
    hunt: function() {
        var player = this.getMap().getPlayer();

        // If we are adjacent to the player, then attack instead of hunting.
        var offsets = Math.abs(player.getX() - this.getX()) + 
            Math.abs(player.getY() - this.getY());
        if (offsets === 1) {
            if (this.hasMixin('Attacker')) {
                this.attack(player);
                return;
            }
        }

        // Generate the path and move to the first tile.
        var source = this;
        var z = source.getZ();
        var path = new ROT.Path.AStar(player.getX(), player.getY(), function(x, y) {
            // If an entity is present at the tile, can't move there.
            var entity = source.getMap().getEntityAt(x, y, z);
            if (entity && entity !== player && entity !== source) {
                return false;
            }
            return source.getMap().getTile(x, y, z).isWalkable();
        }, {topology: 4});
        // Once we've gotten the path, we want to move to the second cell that is
        // passed in the callback (the first is the entity's starting point)
        var count = 0;
        path.compute(source.getX(), source.getY(), function(x, y) {
            if (count == 1) {
                source.tryMove(x, y, z);
            }
            count++;
        });
    },
    wander: function() {
        // Flip coin to determine if moving by 1 in the positive or negative direction
        var moveOffset = (Math.round(ROT.RNG.getUniform()) === 1) ? 1 : -1;
        // Flip coin to determine if moving in x direction or y direction
        if (Math.round(ROT.RNG.getUniform()) === 1) {
            this.tryMove(this.getX() + moveOffset, this.getY(), this.getZ());
        } else {
            this.tryMove(this.getX(), this.getY() + moveOffset, this.getZ());
        }
    }
};

Game.EntityMixins.GiantBossActor = Game.extend(Game.EntityMixins.TaskActor, {
    init: function(template) {
        // Call the task actor init with the right tasks.
        Game.EntityMixins.TaskActor.init.call(this, Game.extend(template, {
            'tasks' : ['growArm', 'spawnSlime', 'hunt', 'wander']
        }));
        // We only want to grow the arm once.
        this._hasGrownArm = false;
    },
    canDoTask: function(task) {
        // If we haven't already grown arm and HP <= 20, then we can grow.
        if (task === 'growArm') {
            return this.getHp() <= 20 && !this._hasGrownArm;
        // Spawn a slime only a 10% of turns.
        } else if (task === 'spawnSlime') {
            return Math.round(ROT.RNG.getUniform() * 100) <= 10;
        // Call parent canDoTask
        } else {
            return Game.EntityMixins.TaskActor.canDoTask.call(this, task);
        }
    },
    growArm: function() {
        this._hasGrownArm = true;
        this.increaseAttackValue(5);
        // Send a message saying the monster grew an arm.
        Game.sendMessageNearby(this.getMap(),
            this.getX(), this.getY(), this.getZ(),
            '%c{red}An extra tentacle erupts on the monster!');
    },
    spawnSlime: function() {
        // Generate a random position nearby.
        var xOffset = Math.floor(ROT.RNG.getUniform() * 3) - 1;
        var yOffset = Math.floor(ROT.RNG.getUniform() * 3) - 1;

        // Check if we can spawn an entity at that position.
        if (!this.getMap().isEmptyFloor(this.getX() + xOffset, this.getY() + yOffset,
            this.getZ())) {
            // If we cant, do nothing
            return;
        }
        // Create the entity
        var slime = Game.EntityRepository.create('slime');
        slime.setX(this.getX() + xOffset);
        slime.setY(this.getY() + yOffset)
        slime.setZ(this.getZ());
        this.getMap().addEntity(slime);
        
        // Send a message saying the Spawn appeared.
        Game.sendMessageNearby(this.getMap(),
            this.getX(), this.getY(), this.getZ(),
            '%c{red}A Formless Spawn crawls from a hole nearby to fight!');
    },
    listeners: {
        onDeath: function(attacker) {
            // Switch to win screen when killed!
            Game.switchScreen(Game.Screen.winScreen);
        }
    }
});

// This signifies our entity can attack basic destructible entities
Game.EntityMixins.Attacker = {
    name: 'Attacker',
    groupName: 'Attacker',
    init: function(template) {
        this._attackValue = template['attackValue'] || 1;
        this._poisonous = template['poisonous'] || false;
        this._poisonRate = template['poisonRate'] || 0;
        this._poisonDuration = template['poisonDuration'] || 0;
    },
    getAttackValue: function() {
        var modifier = 0;
        // If we can equip items, then have to take into 
        // consideration weapon and armor
        if (this.hasMixin(Game.EntityMixins.Equipper)) {
            if (this.getWeapon()) {
                modifier += this.getWeapon().getAttackValue();
            }
            if (this.getArmor()) {
                modifier += this.getArmor().getAttackValue();
            }
        }
        return this._attackValue + modifier;
    },
    isPoisonous: function() {
    	return this._poisonous;
    },    
    increaseAttackValue: function(value) {
    	// If no value was passed, default to 2.
        value = value || 2;
        // Add to the attack value.
        this._attackValue += 2;
        if(this.hasMixin(Game.EntityMixins.PlayerActor)){
    		Game.sendMessage(this, "%c{greenyellow}You look stronger!");
        }
    },
    attack: function(target) {
        // If the target is destructible, calculate the damage
        // based on attack and defense value
        if (target.hasMixin('Destructible')) {
            var attack = this.getAttackValue();
            var defense = target.getDefenseValue();
            var max = Math.max(0, attack - defense);
            var damage = 1 + Math.floor(ROT.RNG.getUniform() * max);
            /** FOR DEBUGGING
            console.log(vsprintf("%s vs %s : AV[%d] DV[%d] MAX[%d] DMG[%d]",
            		[
        		 		this.getName(),
        		 		target.getName(),
        		 		attack,
        		 		defense,
        		 		max,
        		 		damage
            		]));
			**/
            Game.sendMessage(this, '%c{greenyellow}You strike the '+target.getName()+' for '+damage+' damage!');
            Game.sendMessage(target, '%c{red}The '+this.getName()+' strikes you for '+damage+' damage!');

            target.takeDamage(this, damage);
        }
        
        // poisonous attack
        if(this._poisonous && target.hasMixin('Poisonable') && target.hasMixin('Destructible')){
        	target.applyPoison(this,this._poisonDuration, this._poisonRate);
        }
    }
};

Game.EntityMixins.Poisonable = {
	name: 'Poisonable',
	init: function(template) {
        this._poisonDmgRate = template['poisonDmgRate'] || 5;
        this._poisonedTurns = 0;
        this._isPoisoned = false;
	},
	applyPoison: function(attacker, turns, dmg) {
		this._poisonedTurns = turns;
		this._poisonDmgRate = dmg;
		this._attacker = attacker;
        this._isPoisoned = true;
	},
    actPoisonTurn: function() {
        if(this._poisonedTurns > 0 ){
        	this._poisonedTurns--;
            this._isPoisoned = true;
        	if(this.hasMixin(Game.EntityMixins.Destructible)){
        		Game.sendMessage(this, '%c{yellowgreen}You take '+this._poisonDmgRate+' poison damage.');
        		this.takeDamage(this._attacker, this._poisonDmgRate);
        	}
        } else {
        	this._isPoisoned = false;
        }
    },
    getPoisonState: function() {
    	return [this._isPoisoned, this._poisonedTurns];
    }
}

//This mixin signifies an entity can take damage and be destroyed
Game.EntityMixins.Destructible = {
    name: 'Destructible',
    init: function(template) {
        this._maxHp = template['maxHp'] || 10;
        // We allow taking in health from the template incase we want
        // the entity to start with a different amount of HP than the
        // max specified.
        this._hp = template['hp'] || this._maxHp;
        this._defenseValue = template['defenseValue'] || 0;
    },
    getDefenseValue: function() {
        var modifier = 0;
        // If we can equip items, then have to take into 
        // consideration weapon and armor
        if (this.hasMixin(Game.EntityMixins.Equipper)) {
            if (this.getWeapon()) {
                modifier += this.getWeapon().getDefenseValue();
            }
            if (this.getArmor()) {
                modifier += this.getArmor().getDefenseValue();
            }
        }
        return this._defenseValue + modifier;
    },
    setHp: function(hp) {
        this._hp = hp;
    },
    increaseDefenseValue: function(value) {
        // If no value was passed, default to 2.
        value = value || 2;
        // Add to the defense value.
        this._defenseValue += 2;
        if(this.hasMixin(Game.EntityMixins.PlayerActor)){
    		Game.sendMessage(this, "%c{greenyellow}You look tougher!");
        }
    },
    increaseMaxHp: function(value) {
        // If no value was passed, default to 10.
        value = value || 10;
        // Add to both max HP and HP.
        this._maxHp += 10;
        this._hp += 10;
        if(this.hasMixin(Game.EntityMixins.PlayerActor)){
    		Game.sendMessage(this, "%c{greenyellow}You look healthier!");
        }
    },
    getHp: function() {
        return this._hp;
    },
    getMaxHp: function() {
        return this._maxHp;
    },
    takeDamage: function(attacker, damage) {
        this._hp -= damage;
        // If have 0 or less HP, then remove ourselves from the map
        if (this._hp <= 0) {
            Game.sendMessage(attacker, '%c{greenyellow}You kill the '+this.getName()+'!');
            
            // Raise events
            this.raiseEvent('onDeath', attacker);
            attacker.raiseEvent('onKill', this);
            
            if(this.hasMixin(Game.EntityMixins.PlayerActor)) {
            	if(attacker.hasType("infernal")){
                    this.kill('infernal', "You have died!");
            	} else if(attacker.hasType("animal")){
            		 this.kill('animal', "You have died!");
            	} else {
                    this.kill('combat', "You have died!");
            	}
            } else {
        		this.kill();
            }
        }
    },
    listeners: {
        onGainLevel: function() {
            // Heal the entity.
            this.setHp(this.getMaxHp());
        }
    }
};

Game.EntityMixins.MessageRecipient = {
    name: 'MessageRecipient',
    init: function(template) {
        this._messages = [];
    },
    receiveMessage: function(message) {
        this._messages.push(message);
    },
    getMessages: function() {
        return this._messages;
    },
    clearMessages: function() {
        this._messages = [];
    }
};

// This signifies our entity possesses a field of vision of a given radius.
Game.EntityMixins.Sight = {
    name: 'Sight',
    groupName: 'Sight',
    init: function(template) {
        this._sightRadius = template['sightRadius'] || 5;
    },
    increaseSightRadius: function(value) {
        // If no value was passed, default to 1.
        value = value || 1;
        // Add to sight radius.
        this._sightRadius += 1;
    	//console.log(this.hasMixin(Game.EntityMixins.PlayerActor));
        if(this.hasMixin(Game.EntityMixins.PlayerActor)){
    		Game.sendMessage(this, "%c{greenyellow}You are more aware of your surroundings!");
        }
    },
    getSightRadius: function() {
        return this._sightRadius;
    },
    canSee: function(entity) {
        // If not on the same map or on different floors, then exit early
        if (!entity || this._map !== entity.getMap() || this._z !== entity.getZ()) {
            return false;
        }

        var otherX = entity.getX();
        var otherY = entity.getY();

        // If we're not in a square field of view, then we won't be in a real
        // field of view either.
        if ((otherX - this._x) * (otherX - this._x) +
            (otherY - this._y) * (otherY - this._y) >
            this._sightRadius * this._sightRadius) {
            return false;
        }

        // Compute the FOV and check if the coordinates are in there.
        var found = false;
        this.getMap().getFov(this.getZ()).compute(
            this.getX(), this.getY(), 
            this.getSightRadius(), 
            function(x, y, radius, visibility) {
                if (x === otherX && y === otherY) {
                    found = true;
                }
            });
        return found;
    }
};

// Message sending functions
Game.sendMessage = function(recipient, message, args) {
	/*We're spamming messages to all entities not just the player!*/
	console.log("Game.sendMessage "+recipient._name+" "+message+" "+args);
    // Make sure the recipient can receive the message
    // before doing any work.
    if (recipient.hasMixin(Game.EntityMixins.MessageRecipient)) {
        // If args were passed, then we format the message, else
        // no formatting is necessary
        if (args) {
            message = vsprintf(message, args);
        }
        recipient.receiveMessage(message);
    }
};
Game.sendMessageNearby = function(map, centerX, centerY, centerZ, message, args) {
    // If args were passed, then we format the message, else
    // no formatting is necessary
    if (args) {
        message = vsprintf(message, args);
    }
    // Get the nearby entities
    entities = map.getEntitiesWithinRadius(centerX, centerY, centerZ, 5);
    // Iterate through nearby entities, sending the message if
    // they can receive it.
    for (var i = 0; i < entities.length; i++) {
        if (entities[i].hasMixin(Game.EntityMixins.MessageRecipient)) {
            entities[i].receiveMessage(message);
        }
    }
};

Game.EntityMixins.InventoryHolder = {
    name: 'InventoryHolder',
    init: function(template) {
        // Default to 10 inventory slots.
        var inventorySlots = template['inventorySlots'] || 10;
        // Set up an empty inventory.
        this._items = new Array(inventorySlots);
    },
    getItems: function() {
        return this._items;
    },
    getItem: function(i) {
        return this._items[i];
    },
    addItem: function(item) {
        // Try to find a slot, returning true only if we could add the item.
        for (var i = 0; i < this._items.length; i++) {
            if (!this._items[i]) {
                this._items[i] = item;    

                console.log(item);
                //console.log("Game.Narrator.getHelpItem(edible) "+Game.Narrator.getHelpItem("edible"));
                if(Game.Narrator.getHelpItem("edible")){
                	if(item.hasMixin){
                    	if(item.hasMixin("Edible")){
                    		Game.Narrator.helpText("edible", {glyph:item});
                		}
                	}
                } 
            	
                if(Game.Narrator.getHelpItem("wearable")){
                	if(item.hasMixin){
                    	if(item.hasMixin("Equippable")){
                    		if(item.isWearable()){
                        		Game.Narrator.helpText("wearable", {glyph:item});
                    		}
                		}
                	}
                } 
                
            	if(Game.Narrator.getHelpItem("wieldable")){
                	if(item.hasMixin){
                    	if(item.hasMixin("Equippable")){
                    		if(item.isWieldable()){
                        		Game.Narrator.helpText("wieldable", {glyph:item});
                    		}
                		}
                	}
                } 
                
                return true;
            }
        }
        return false;
    },
    removeItem: function(i) {
        // If we can equip items, then make sure we unequip the item we are removing.
        if (this._items[i] && this.hasMixin(Game.EntityMixins.Equipper)) {
            this.unequip(this._items[i]);
        }
        // Simply clear the inventory slot.
        this._items[i] = null;
    },
    canAddItem: function() {
        // Check if we have an empty slot.
        for (var i = 0; i < this._items.length; i++) {
            if (!this._items[i]) {
                return true;
            }
        }
        return false;
    },
    pickupItems: function(indices) {
        // Allows the user to pick up items from the map, where indices is
        // the indices for the array returned by map.getItemsAt
        var mapItems = this._map.getItemsAt(this.getX(), this.getY(), this.getZ());
        var added = 0;
        // Iterate through all indices.
        for (var i = 0; i < indices.length; i++) {
            // Try to add the item. If our inventory is not full, then splice the
            // item out of the list of items. In order to fetch the right item, we
            // have to offset the number of items already added.
            if (this.addItem(mapItems[indices[i] - added])) {
                mapItems.splice(indices[i] - added, 1);
                added++;
            } else {
                // Inventory is full
                if(Game.Narrator.getHelpItem("drop")){
                	Game.Narrator.helpText("drop");
                }
                break;
            }
        }
        // Update the map items
        this._map.setItemsAt(this.getX(), this.getY(), this.getZ(), mapItems);
        // Return true only if we added all items
        return added === indices.length;
    },
    dropItem: function(i) {
        // Drops an item to the current map tile
        if (this._items[i]) {
            if (this._map) {
                this._map.addItem(this.getX(), this.getY(), this.getZ(), this._items[i]);
            }
            this.removeItem(i);
        }
    }
};

Game.EntityMixins.FoodConsumer = {
    name: 'FoodConsumer',
    init: function(template) {
        this._maxFullness = template['maxFullness'] || 1000;
        // Start halfway to max fullness if no default value
        this._fullness = template['fullness'] || (this._maxFullness / 2);
        // Number of points to decrease fullness by every turn.
        this._fullnessDepletionRate = template['fullnessDepletionRate'] || 1;
    },
    addTurnHunger: function() {
        // Remove the standard depletion points
        this.modifyFullnessBy(-this._fullnessDepletionRate);
    },
    modifyFullnessBy: function(points) {
    	if(points < -10){
    		Game.sendMessage(this, "%c{red}That item you ate made you sick (lose "+points+" nutrition).");
    	}
    	this._fullness = this._fullness + points;
        if (this._fullness <= 0) {
            this.kill("starvation", "You have died of starvation!");
        } else if (this._fullness > this._maxFullness) {
            this.kill("gluttony", "You choke while eating and die!");
        }
    },
    getHungerState: function() {
        // Fullness points per percent of max fullness
        var perPercent = this._maxFullness / 100;
        // 5% of max fullness or less = starving
        if (this._fullness <= perPercent * 25) {
            return 'Starving';
        // 25% of max fullness or less = hungry
        } else if (this._fullness <= perPercent * 50) {
            return 'Hungry';
        // 95% of max fullness or more = oversatiated
        } else if (this._fullness >= perPercent * 95) {
            return 'Oversatiated!';
        // 75% of max fullness or more = full
        } else if (this._fullness >= perPercent * 75) {
            return 'Well Fed';
        // Anything else = not hungry
        } else {
            return 'Not Hungry';
        }
    },
    getFullness: function() {
    	return this._fullness;
    },
    getMaxFullness: function() {
    	return this._maxFullness;
    }
    
};

Game.EntityMixins.CorpseDropper = {
    name: 'CorpseDropper',
    init: function(template) {
        // Chance of dropping a corpse (out of 100).
        this._corpseDropRate = template['corpseDropRate'] || 100;
    },
    listeners: {
        onDeath: function(attacker) {
            // Check if we should drop a corpse.
            if (Math.round(ROT.RNG.getUniform() * 100) <= this._corpseDropRate) {
                // Create a new corpse item and drop it.
                this._map.addItem(this.getX(), this.getY(), this.getZ(),
                    Game.ItemRepository.create('corpse', {
                        name: this._name + ' corpse',
                        foreground: this._foreground
                    }));
            }    
        }
    }
};

Game.EntityMixins.MeatDropper = {
    name: 'MeatDropper',
    init: function(template) {
        // Chance of dropping meat (out of 100).
        this._meatDropRate = template['meatDropRate'] || 0;
        this._foodValue = template['foodValue'] || 50;
    },
    listeners: {
        onDeath: function(attacker) {
            // Check if we should drop some meat.
            if (Math.round(ROT.RNG.getUniform() * 100) <= this._meatDropRate) {
                this._map.addItem(this.getX(), this.getY(), this.getZ(),
                        Game.ItemRepository.create('meat', {
                            name: this._name + ' meat',
                            foreground: this._foreground,
                            foodValue: this._foodValue
                        }));
            }    
        }
    }
};

Game.EntityMixins.ItemDropper = {
    name: 'ItemDropper',
    init: function(template) {
        // Chance of dropping an item (out of 100).
        this._itemDropRate = template['itemDropRate'] || 100;
        this._itemDropList = template['itemDropList'] || [];
    },
    listeners: {
        onDeath: function(attacker) {
            // Check if we should drop an item.
            if (Math.round(ROT.RNG.getUniform() * 100) <= this._itemDropRate) {
            	if(this._itemDropList.length > 0){
            		var newItem = this._itemDropList.random();
            		console.log(newItem);
                    this._map.addItem(this.getX(), this.getY(), this.getZ(),
                            Game.ItemRepository.create(newItem));
            	}
            }    
        }
    }
};

Game.EntityMixins.Equipper = {
    name: 'Equipper',
    init: function(template) {
        this._weapon = null;
        this._armor = null;
    },
    wield: function(item) {
        this._weapon = item;
    },
    unwield: function() {
        this._weapon = null;
    },
    wear: function(item) {
        this._armor = item;
    },
    takeOff: function() {
        this._armor = null;
    },
    getWeapon: function() {
        return this._weapon;
    },
    getArmor: function() {
        return this._armor;
    },
    unequip: function(item) {
        // Helper function to be called before getting rid of an item.
        if (this._weapon === item) {
            this.unwield();
        }
        if (this._armor === item) {
            this.takeOff();
        }
    }
};

Game.EntityMixins.ExperienceGainer = {
    name: 'ExperienceGainer',
    init: function(template) {
        this._level = template['level'] || 1;
        this._experience = template['experience'] || 0;
        this._statPointsPerLevel = template['statPointsPerLevel'] || 1;
        this._statPoints = 0;
        // Determine what stats can be leveled up.
        this._statOptions = [];
        if (this.hasMixin('Attacker')) {
            this._statOptions.push(['Increase attack value', this.increaseAttackValue]);
        }
        if (this.hasMixin('Destructible')) {
            this._statOptions.push(['Increase defense value', this.increaseDefenseValue]);   
            this._statOptions.push(['Increase max health', this.increaseMaxHp]);
        }
        if (this.hasMixin('Sight')) {
            this._statOptions.push(['Increase sight range', this.increaseSightRadius]);
        }
    },
    getLevel: function() {
        return this._level;
    },
    getExperience: function() {
        return this._experience;
    },
    getNextLevelExperience: function() {
        return (this._level * this._level) * 10;
    },
    getStatPoints: function() {
        return this._statPoints;
    },
    setStatPoints: function(statPoints) {
        this._statPoints = statPoints;
    },
    getStatOptions: function() {
        return this._statOptions;
    },
    giveExperience: function(points) {
        var statPointsGained = 0;
        var levelsGained = 0;
        // Loop until we've allocated all points.
        while (points > 0) {
            // Check if adding in the points will surpass the level threshold.
            if (this._experience + points >= this.getNextLevelExperience()) {
                // Fill our experience till the next threshold.
                var usedPoints = this.getNextLevelExperience() - this._experience;
                points -= usedPoints;
                this._experience += usedPoints;
                // Level up our entity!
                this._level++;
                levelsGained++;
                this._statPoints += this._statPointsPerLevel;
                statPointsGained += this._statPointsPerLevel;
            } else {
                // Simple case - just give the experience.
                this._experience += points;
                points = 0;
            }
        }
        // Check if we gained at least one level.
        if (levelsGained > 0) {
        	if(this.hasMixin(Game.EntityMixins.PlayerActor)){
        		Game.sendMessage(this, "%c{greenyellow}You advance to level "+this._level+".");
        	}
            this.raiseEvent('onGainLevel');
        }
    },
    listeners: {
        onKill: function(victim) {
            var exp = victim.getMaxHp() + victim.getDefenseValue();
            if (victim.hasMixin('Attacker')) {
                exp += victim.getAttackValue();
            }
            // Account for level differences
            if (victim.hasMixin('ExperienceGainer')) {
                exp -= (this.getLevel() - victim.getLevel()) * 3;
            }
            // Only give experience if more than 0.
            if (exp > 0) {
                this.giveExperience(exp);
            }
        }
    }
};

Game.EntityMixins.RandomStatGainer = {
    name: 'RandomStatGainer',
    groupName: 'StatGainer',
    listeners: {
	    onGainLevel: function() {
	        var statOptions = this.getStatOptions();
	        // Randomly select a stat option and execute the callback for each
	        // stat point.
	        while (this.getStatPoints() > 0) {
	            // Call the stat increasing function with this as the context.
	            statOptions.random()[1].call(this);
	            this.setStatPoints(this.getStatPoints() - 1);
	        }
	    }
    }
};

Game.EntityMixins.PlayerStatGainer = {
    name: 'PlayerStatGainer',
    groupName: 'StatGainer',
    listeners: {
        onGainLevel: function() {
            // Setup the gain stat screen and show it.
            Game.Screen.gainStatScreen.setup(this);
            Game.Screen.playScreen.setSubScreen(Game.Screen.gainStatScreen);
        }
    }
};


Game.EntityMixins.Digger = {
    name: 'Digger',
    listeners: {}
};