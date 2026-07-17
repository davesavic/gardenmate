import * as GardenService from "../bindings/gardenmate/gardenservice.js";
import { Events } from "@wailsio/runtime";

window.wails = GardenService;
window.runtime = {
  EventsOn: (name, callback) => Events.On(name, (ev) => callback(ev.data)),
};
