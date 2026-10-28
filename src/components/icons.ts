import { defineComponent, h } from 'vue'
import AppIcon from './AppIcon.vue'

function icon(name: string) {
  return defineComponent({
    name: `${name}Icon`,
    props: { size: { type: [Number, String], default: 22 }, strokeWidth: [Number, String] },
    setup: (props) => () => h(AppIcon, { name, size: props.size })
  })
}

export const ArrowLeft = icon('ArrowLeft')
export const Check = icon('Check')
export const ChevronRight = icon('ChevronRight')
export const CircleAlert = icon('CircleAlert')
export const Cloud = icon('Cloud')
export const Database = icon('Database')
export const Film = icon('Film')
export const Folder = icon('Folder')
export const Gauge = icon('Gauge')
export const History = icon('History')
export const House = icon('House')
export const LibraryBig = icon('LibraryBig')
export const Link = icon('Link')
export const LoaderCircle = icon('LoaderCircle')
export const LogOut = icon('LogOut')
export const Pencil = icon('Pencil')
export const Play = icon('Play')
export const Plus = icon('Plus')
export const RefreshCw = icon('RefreshCw')
export const RotateCcw = icon('RotateCcw')
export const Search = icon('Search')
export const Settings = icon('Settings')
export const ShieldCheck = icon('ShieldCheck')
export const Trash2 = icon('Trash2')
export const X = icon('X')

export const CalendarDays = icon('CalendarDays')
export const SquarePlay = icon('SquarePlay')
export const Pause = icon('Pause')
export const Maximize = icon('Maximize')
