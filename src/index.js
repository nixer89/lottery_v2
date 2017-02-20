/**
    Copyright 2014-2015 Amazon.com, Inc. or its affiliates. All Rights Reserved.
    Licensed under the Apache License, Version 2.0 (the "License"). You may not use this file except in compliance with the License. A copy of the License is located at
        http://aws.amazon.com/apache2.0/
    or in the "license" file accompanying this file. This file is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
*/

/**
 * App ID for the skill
 */
var APP_ID = process.env.APP_ID;

/**
 * The AlexaSkill prototype and helper functions
 */
var AlexaSkill = require('./AlexaSkill');
var skillHelperPrototype = require('./SkillHelper');

var skillHelper = new skillHelperPrototype();

/**
 * Lotto is a child of AlexaSkill.
 * To read more about inheritance in JavaScript, see the link below.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Introduction_to_Object-Oriented_JavaScript#Inheritance
 */
var Lotto = function () {
    AlexaSkill.call(this, APP_ID);
};

//var locale = "de-DE";

// Extend AlexaSkill
Lotto.prototype = Object.create(AlexaSkill.prototype);
Lotto.prototype.constructor = Lotto;

Lotto.prototype.eventHandlers.onSessionStarted = function (sessionStartedRequest, session) {
    console.log("Lotto onSessionStarted requestId: " + sessionStartedRequest.requestId + ", sessionId: " + session.sessionId);
    // any initialization logic goes here
};

Lotto.prototype.eventHandlers.onLaunch = function (launchRequest, session, response) {
    response.ask("Willkommen bei Mein Lotto! Sage 'Feld hinzufügen und den Lotterie-Namen' um deine Lottozahlen zu speichern oder sage 'Hilfe' um dir weitere Kommandos in der Alexa App anzusehen.", "Sage 'Hilfe' um Kommandos in der Alexa App zu sehen!");
};

Lotto.prototype.eventHandlers.onSessionEnded = function (sessionEndedRequest, session) {
    console.log("Lotto onSessionEnded requestId: " + sessionEndedRequest.requestId + ", sessionId: " + session.sessionId);
    // any cleanup logic goes here
};

var DE_Intent_Handler  = {
    // register custom intent handlers
    "HelloIntent": function (intent, session, response) {
        checkIntentStatus(session,response);
        response.ask("Hallo. Wenn du hilfe brauchst, sage einfach 'Hilfe'!", "Hallo!", "Hallo!");
    },
    "NewNumber": function (intent, session, response) {
        checkRemoveNumbersIntent(session, response);

        if(session.attributes.isAddingField && intent.slots.lotteryNumber.value) {
            doLotteryNumberCheck(response, session, intent.slots.lotteryNumber.value);
        } else if(intent.slots.lotteryNumber.value && !session.attributes.isAddingField) {
            response.ask("Wenn du deine Zahlen hinzufügen willst, musst du 'Feld hinzufügen und den Lotterie-Namen' sagen.")
        }else {
            response.ask("Tut mir leid, ich konnte die Zahl nicht verstehen. Bitte sage sie noch einmal.");
        }
    },
    "AddLotteryNumbers": function (intent, session, response) {
        checkIntentStatus(session, response);
        if(intent.slots.lotteryName.value) {
            setUpForNewField(session, intent.slots.lotteryName.value);
            response.ask("Ein neues Feld wird für " + session.attributes.currentConfig.speechLotteryName + " angelegt. Wie lautet deine erste Zahl?", "Wie lautet deine erste Zahl?");
        } else {
            response.ask("Tut mir leid, diese Lotterie kenne ich nicht. Frage mich, welche Lotterien unterstützt werden, um eine Übersicht in der Alexa App zu erhalten");
        }
    },
    "RemoveLotteryNumbers": function (intent, session, response) {
        checkIntentStatus(session,response);
        if(intent.slots.lotteryName.value) {
            session.attributes.currentConfig = skillHelper.getConfigByUtterance(intent.slots.lotteryName.value);
            session.attributes.isRemovingNumbers = true;
            response.ask("Alle deine Zahlen für " + session.attributes.currentConfig.speechLotteryName + " werden gelöscht und müssen neu angelegt werden. Bist du sicher?");
        } else {
             response.ask("Tut mir leid, diese Lotterie kenne ich nicht. Frage mich, welche Lotterien unterstützt werden, um eine Übersicht in der Alexa App zu erhalten");
        }
    },
    "AMAZON.YesIntent": function (intent, session, response) {
        if(session.attributes.isAddingField && lotteryFieldHasMaxLength(session)) {
            //add new field
            saveNewLottoNumbers(session, response);
        } else if (session.attributes.isRemovingNumbers && session.attributes.currentConfig) {
            //remove all numbers
            skillHelper.getLotteryDbHelper(session.attributes.currentConfig.lotteryName).removeLotteryNumbers(session.user.userId).then(function(result) {
                if(result) {
                    response.tell("Deine Zahlen für " + session.attributes.currentConfig.speechLotteryName + " wurden erfolgreich gelöscht!");
                }
            }).catch(function(error) {
                response.tell("Beim Löschen deiner Zahlen ist ein Fehler aufgetreten.");
            });
        } else {
            checkAddFieldIntent(session, response);
            response.ask("Entschuldige, ich habe dich nicht verstanden.");
        }
    },
    "AMAZON.NoIntent": function (intent, session, response) {
        if(session.attributes.isAddingField && lotteryFieldHasMaxLength(session)) {
            session.attributes.isAddingField = false;
            response.tell("Ok, deine " + session.attributes.currentConfig.speechLotteryName + " Zahlen werden nicht gespeichert!");
        } else if(session.attributes.isRemovingNumbers) {
            session.attributes.isRemovingNumbers = false;
            response.tell("Ok, deine " + session.attributes.currentConfig.speechLotteryName + "  Zahlen werden nicht gelöscht!!");
        } else {
            checkAddFieldIntent(session, response);
            response.ask("Entschuldige, ich habe dich nicht verstanden.");
        }
    },
    "AskForLotteryWinIntent": function (intent, session, response) {
        checkIntentStatus(session, response);
        if(intent.slots.lotteryName.value) {
            var config = skillHelper.getConfigByUtterance(intent.slots.lotteryName.value);
            session.attributes.currentConfig = config;

            readLotteryNumbers(session, response).then(function(myNumbers) {
                if(myNumbers && myNumbers.length > 0) {
                    skillHelper.getLotteryApiHelper(session.attributes.currentConfig.lotteryName).getLastLotteryDateAndNumbers().then(function(lotteryNumbersAndDate) {
                        if(lotteryNumbersAndDate) {
                            //check how many matches we have with the given numbers!
                            var numberOfMatchesMain = 0;
                            var numberOfMatchesAdditional= 0;
                            var rank = 1000;

                            for(var i = 0; i < myNumbers.length; i++) {
                                var numberOfMatchesMainTmp = getMatchingNumbers(lotteryNumbersAndDate[0], myNumbers[i][0]).length;
                                var numberOfMatchesAdditionalTmp = getMatchingNumbers(lotteryNumbersAndDate[1], myNumbers[i][1]).length;

                                var rankTemp = skillHelper.getLotteryApiHelper(session.attributes.currentConfig.lotteryName).getLotteryOddRank(numberOfMatchesMainTmp,numberOfMatchesAdditionalTmp);

                                if(rankTemp < rank) {
                                    rank = rankTemp;
                                    numberOfMatchesMain = numberOfMatchesMainTmp; 
                                    numberOfMatchesAdditional = numberOfMatchesAdditionalTmp;
                                    gewinnZahlen = myNumbers[i]; // save for later use maybe?
                                }
                            }

                            skillHelper.getLotteryApiHelper(session.attributes.currentConfig.lotteryName).getLastPrizeByRank(rank).then(function(money) {
                                var moneySpeech = ""
                                if(money && money.length > 0)
                                    moneySpeech = "Dein Gewinn beträgt " + money + " Euro.";
                                else
                                    moneySpeech = "Die Gewinnsumme steht noch nicht fest."
                                    
                                var speechOutput = skillHelper.getLotteryApiHelper(session.attributes.currentConfig.lotteryName).createLotteryWinSpeechOutput(rank, moneySpeech, lotteryNumbersAndDate[2]);
                                response.tell({type:"SSML",speech: speechOutput});
                            }).catch(function(err) {
                                response.tell("Bei der Abfrage der letzten Ziehung ist ein Fehler aufgetreten. Bitte entschuldige.");    
                            });
                        } else {
                            response.tell("Bei der Abfrage der letzten Ziehung ist ein Fehler aufgetreten. Bitte entschuldige.");
                        }
                    });
                }
                else {
                    response.ask("Du musst erst Zahlen für " + config.speechLotteryName + " hinterlegen, damit ich prüfen kann, ob du gewonnen hast. Sage dazu einfach 'Feld hinzufügen "+ config.speechLotteryName);
                }
            });
        } else {
            response.ask("Entschuldige, ich habe dich nicht verstanden.");
        }
    },
    "MyCurrentNumbers": function (intent, session, response) {
        checkIntentStatus(session,response);
        if(intent.slots.lotteryName.value) {
            var config = skillHelper.getConfigByUtterance(intent.slots.lotteryName.value);
            session.attributes.currentConfig = config;

            readLotteryNumbers(session, response).then(function(myNumbers) {
                if(myNumbers && myNumbers.length > 0) {
                    var speakOutput = "<speak>Hier sind deine aktuell gespeicherten "+ config.speechLotteryName + " Zahlen. <break time=\"200ms\"/>";

                    for(var i = 0; i < myNumbers.length; i++) {
                        speakOutput += (myNumbers.length > 1 ? "Feld " + (i+1) : "") + ": <break time=\"500ms\"/>";
                        speakOutput += skillHelper.getLotteryApiHelper(session.attributes.currentConfig.lotteryName).createSSMLOutputForField(myNumbers[i]);
                        speakOutput += ". ";
                    }
                    speakOutput += "</speak>";

                    response.tell({type:"SSML",speech: speakOutput});

                } else {
                    response.ask("Du hast noch keine Zahlen für "+ config.speechLotteryName + " hinterlegt. Sage 'Feld hinzufügen "+ config.speechLotteryName + "' um deine Zahlen anzulegen.");
                }
            });
        } else {
            response.ask("Entschuldige, ich habe dich nicht verstanden.");
        }
    },
    "AskForLatestLotteryNumbers": function (intent, session, response) {
        checkIntentStatus(session,response);
        if(intent.slots.lotteryName.value) {
            var config = skillHelper.getConfigByUtterance(intent.slots.lotteryName.value);
            
            skillHelper.getLotteryApiHelper(config.lotteryName).getLastLotteryDateAndNumbers().then(function(numbers) {
                if(numbers) {
                    var speakOutput = "<speak>Hier sind die Gewinnzahlen der letzten " + config.speechLotteryName + " Ziehung von " + numbers[2] + ". <break time=\"500ms\"/>";
                    speakOutput += skillHelper.getLotteryApiHelper(config.lotteryName).createSSMLOutputForNumbers(numbers[0], numbers[1]);
                    speakOutput += ". <break time=\"200ms\"/>Alle Angaben wie immer ohne Gewähr</speak>";

                    response.tell({type:"SSML",speech: speakOutput});
                } else {
                    response.tell("Bei der Abfrage der letzten Ziehung ist ein Fehler aufgetreten. Bitte entschuldige.");
                }
            });
        }
        else {
            response.ask("Entschuldige, ich habe dich nicht verstanden.");
        }
     },
     "SupportedLotteries": function (intent, session, response) {
         response.ask("Aktuell werden nur die Lotteriesysteme 6aus49, Eurojackpot, EuroMillions, PowerBall und MegaMillions unterstützt. Sage: Füge ein Feld für 6aus49 hinzu, um deine Lottozahlen zu speichern oder sage: Beenden, um den Skill zu schließen.");
     },
     "NullNumberIntent": function (intent, session, response) {
         if(session.attributes.isAddingField) {
             response.ask("Die Zahl muss größer als 0 sein! Bitte wähle eine neue Zahl.");
         }
         
         checkIntentStatus(session, response);
         response.ask("Entschuldige, ich habe dich nicht verstanden.");
     },
     "EndIntent": function (intent, session, response) {
         response.tell("Tschüss und weiterhin viel Glück!");
     },
     "ThanksIntent": function (intent, session, response) {
         checkIntentStatus(session, response);
         response.tell("Bitte!");
     },
    "AMAZON.HelpIntent": function (intent, session, response) {
        checkIntentStatus(session,response);

        var help = "Mit diesem Skill kannst du deine Lottozahlen hinterlegen und abfragen, ob du gewonnen hast. Deine Zahlen werden dann gegen die letzten Ziehung der angegebenen Lotterie verglichen. Ich habe ein paar Beispiel-Kommandos an die Alexa App gesendet. Öffne die App und schaue dir die Kommandos an. Um zu erfahren, welche Lotteriesysteme unterstüzt werden, frage einfach: Welche Lotterien werden unterstützt?";
        var repromt = "Sage: Feld hinzufügen 6aus49, um deine Lottozahlen zu hinterlegen."
        var cardTitle = "MeinLotto Kommandos";
        var cardContent = "Hier sind ein paar nützliche Kommandos. Du musst immer den Lotterie-Namen mit angeben!:\n- füge ein Feld für 6aus49 hinzu\n- habe ich in Euro Jackpot gewonnen?\n" +
         "- was sind meine aktuell hinterlegten Zahlen für 6aus49\n- was sind die aktuellen Gewinnzahlen von 6aus49\n- lösche meine Zahlen von Euro Jackpot";
        response.askWithCard(help, repromt, cardTitle, cardContent);
    },
    "AMAZON.StopIntent": function (intent, session, response) {
        response.tell("Tschüss und weiterhin viel Glück!");
    },
    "AMAZON.CancelIntent": function (intent, session, response) {
        response.tell("Tschüss und weiterhin viel Glück!");
    },
    "TestIntent": function (intent, session, response) {
        var germanNumbers = [[["10","20","13","40","15","26"],["7", "1"]],[["49","21","13","31","15","1"],["2","8"]]];

        var config = skillHelper.getConfigByUtterance("sechs aus neunundvierzig");
        skillHelper.getLotteryApiHelper(config.lotteryName).getLastLotteryNumbers().then(function(lotteryNumbers) {
            if(lotteryNumbers) {
                config = skillHelper.getConfigByUtterance("euro jackpot");
                skillHelper.getLotteryApiHelper(config.lotteryName).getLastLotteryNumbers().then(function(lotteryNumbers) {
                    if(lotteryNumbers) {
                    }
                });
            }
        });
    }
};

function setUpForNewField(session, lotteryName) {
    session.attributes.isAddingField = true;
    session.attributes.newNumbersMain = [];
    session.attributes.newNumbersAdditional = [];
    session.attributes.currentConfig = skillHelper.getConfigByUtterance(lotteryName);
}

// Create the handler that responds to the Alexa Request.
exports.handler = function (event, context) {
    // Create an instance of the Lotto skill.
    var lotto = new Lotto();

    //locale = event.request.locale

    //if (locale == 'en-US')
    //    Lotto.intentHandlers = US_Intent_Handler; //register us intent handler
    //else

    //only german supported so far
    lotto.intentHandlers = DE_Intent_Handler; //register german intent handler

    lotto.execute(event, context);
};

function saveNewLottoNumbers(session, response) {
    if(lotteryFieldHasMaxLength(session)) {
        readLotteryNumbers(session , response).then(function(oldNumbers) {
            //convert numbers from int to string
            var newNumbers = [];
            newNumbers[0] = session.attributes.newNumbersMain;
            newNumbers[1] = session.attributes.newNumbersAdditional;

            var convertedNumbers = skillHelper.convertNewNumbersForStoring(newNumbers);
            //set new numbers at the end of all numbers
            oldNumbers[oldNumbers.length] = convertedNumbers;

            skillHelper.getLotteryDbHelper(session.attributes.currentConfig.lotteryName).updateLotteryNumbers(session.user.userId , oldNumbers).then(function(result) {
                if(result) {
                    response.tell("Deine Zahlen wurden erfolgreich gespeichert.")
                } else {
                    response.tell("Deine Zahlen konnten nicht gespeichert werden. Es kam zu einem Fehler.")
                }
            });
        });
    }
}

function readLotteryNumbers(session, response) {
    return skillHelper.getLotteryDbHelper(session.attributes.currentConfig.lotteryName).readLotteryNumbers(session.user.userId).then(function(result) {
            if(result) {
                if(result.length > 0)
                    //always sort them before returning them (they might be unsorted!!!)
                    return skillHelper.sortLotteryNumbers(result);
                else
                    return [];
            }
            else {
                return [];
            }
        }).catch(function(error) {
            return [];
            //response.tell("Beim Lesen deiner Lottozahlen ist ein Fehler aufgetreten. Bitte versuche es später erneut.");
    });
}

function doLotteryNumberCheck(response, session, newNumber) {
    //noch keine additional numbers -> checke auf range der main numbers
    if(session.attributes.newNumbersMain.length < session.attributes.currentConfig.numberCountMain && (newNumber < 1 || newNumber > session.attributes.currentConfig.maxRangeMain))
        response.ask("Die Zahl darf nicht kleiner als 1 und nicht größer als " + session.attributes.currentConfig.maxRangeMain + " sein. Bitte wähle eine neue Zahl.","Bitte wähle eine neue Zahl.");
    //alle main numbers angegeben, checke auf range der additional numbers
    else if(session.attributes.newNumbersMain.length == session.attributes.currentConfig.numberCountMain && (newNumber < 1 || newNumber > session.attributes.currentConfig.maxRangeAdditional))
        response.ask("Die " + session.attributes.currentConfig.additionalNumberName + " darf nicht kleiner als 1 und nicht größer als " + session.attributes.currentConfig.maxRangeAdditional + " sein. Bitte wähle eine neue Zahl.", "Bitte wähle eine neue Zahl.")
    //prüfe ob eine main number oder eine additional number schon doppelt sind!
    else if((session.attributes.newNumbersMain.length <= session.attributes.currentConfig.numberCountMain -1 && session.attributes.newNumbersMain.indexOf(newNumber) != -1) ||
                (session.attributes.newNumbersAdditional.length <= session.attributes.currentConfig.numberCountAdditional-1 && session.attributes.newNumbersAdditional.indexOf(newNumber) != -1))
            response.ask("Du hast diese Zahl schon angegeben. Doppelte Zahlen sind nicht erlaubt. Bitte wähle eine neue Zahl.", "Bitte wähle eine neue Zahl.");
    else {
        //zahl is valide, also füge sie hinzu!
        if(session.attributes.newNumbersMain.length < session.attributes.currentConfig.numberCountMain)
            session.attributes.newNumbersMain[session.attributes.newNumbersMain.length] = newNumber;
        else
            session.attributes.newNumbersAdditional[session.attributes.newNumbersAdditional.length] = newNumber;

        //check ob weitere Zahlen hinzugefügt werden müssen
        if(lotteryFieldHasMaxLength(session)) {
            session.attributes.newNumbersAdditional = session.attributes.newNumbersAdditional.sort((a, b) => a - b);
            var speakOutput = "<speak>Danke. Deine Zahlen lauten. ";
            speakOutput += skillHelper.getLotteryApiHelper(session.attributes.currentConfig.lotteryName).createSSMLOutputForNumbers(session.attributes.newNumbersMain, session.attributes.newNumbersAdditional);
            speakOutput += ". Ist das korrekt?</speak>";
            response.ask({type:"SSML",speech: speakOutput});

        } else if(session.attributes.newNumbersMain.length == session.attributes.currentConfig.numberCountMain) {
            //sort numbers and add superzahl behind!
            session.attributes.newNumbersMain = session.attributes.newNumbersMain.sort((a, b) => a - b);

            if(session.attributes.currentConfig.numberCountAdditional == 1) {
                response.ask("Wie lautet " + skillHelper.getCorrectPreWordAdditionalNumber(session.attributes.currentConfig.lotteryName) + session.attributes.currentConfig.additionalNumberName + "?");
            } else {
                response.ask("Wie lautet deine " + skillHelper.getCorrectNamingOfNumber((session.attributes.newNumbersAdditional.length + 1)) + " " + session.attributes.currentConfig.additionalNumberName + "?");
            }
        } else {
            response.ask((session.attributes.newNumbersMain.length + 1) + ". Zahl?", "Wie lautet deine " + (session.attributes.newNumbersMain.length + 1) + ". Zahl?");
        }
    }
}

function getMatchingNumbers(gewinnZahlen, myNumbers) {    
    return gewinnZahlen.filter(n => myNumbers.indexOf(n) != -1);
}

function checkIntentStatus(session, response) {
    checkAddFieldIntent(session, response);
    checkRemoveNumbersIntent(session, response);
}

function checkAddFieldIntent(session, response) {
    if(session.attributes.isAddingField && lotteryFieldHasMaxLength(session)) {
        response.ask("Tut mir leid, ich habe dich nicht richtig verstanden. Sage 'JA', um die Zahlen zu speichern, oder 'NEIN', um die Zahlen zu verwerfen.");
    } else if(session.attributes.isAddingField) {
        response.ask("Tut mir leid, ich habe die Zahl nicht richtig verstanden. Bitte wiederhole die Zahl oder sage abbrechen");
    }
}

function checkRemoveNumbersIntent(session, response) {
    if(session.attributes.isRemovingNumbers) {
        response.ask("Tut mir leid, ich habe dich nicht richtig verstanden. Sage 'JA', um die Zahlen zu löschen, oder 'NEIN', um die Zahlen nicht zu löschen.")
    }
}

function lotteryFieldHasMaxLength(session) {
    if(session.attributes.newNumbersMain && session.attributes.newNumbersAdditional)
        return (session.attributes.newNumbersMain.length + session.attributes.newNumbersAdditional.length) == (session.attributes.currentConfig.numberCountMain + session.attributes.currentConfig.numberCountAdditional);
    else
        return false;
}